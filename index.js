/**
 * 全栈铲子 · Host 半。
 *
 * 把「全栈铲子 SOP」从一堆文档变成可以反复执行的动作：
 *  - 一键生成项目骨架（SPEC + 冻结区契约 + 降级链 + 迁移 SQL + 全部文档 + 提示词）
 *  - 六步 SOP 的进度台账（阶段 / 任务勾选 / 下一步）
 *  - P0–P8 提示词按项目变量渲染，小白整段复制给 AI 即可
 *  - 静态体检：core/ 有没有被改、密钥有没有泄漏、mock 是否还在降级链尾、env 填了几层
 *  - 30 条上线验收清单 + 结论（hard 项不通过就不许上线）
 *  - 单位经济测算：单次成本 × 调用量 ≤ 定价
 *
 * 状态存在 ~/.dsh/shovel/state.json；项目默认落在 ~/.dsh/shovel/projects/<slug>（可用 DSH_SHOVEL_PROJECTS 覆盖）。
 * 浏览器半通过 POST /api/dsh-shovel（Connection Fetch 鉴权）调用同一批动作，
 * token 兜底通道 /dsh-shovel/api 供脚本使用。
 */
import { createHash, randomBytes } from 'node:crypto'
import { promises as fsp } from 'node:fs'
import { execFile } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { STAGES, CHECKLIST, ENV_LEVELS, SECRET_PATTERNS, computeEconomics } from './assets/workflow.js'
import { PROMPTS, kickoff, promptIndex } from './assets/prompts.js'

export const name = 'dsh-shovel'
export const inject = ['connection', 'tools']

const PKG_DIR = path.dirname(fileURLToPath(import.meta.url))
const ASSETS = path.join(PKG_DIR, 'assets')
const SKELETON = path.join(ASSETS, 'skeleton')
const ROUTE_API = '/api/dsh-shovel'
const ROUTE_TOKEN = '/dsh-shovel/token'
const ROUTE_FALLBACK = '/dsh-shovel/api'
const STATE_VERSION = 1
const SKIP_DIRS = new Set(['node_modules', '.git', '.next', 'out', 'dist', 'coverage', '.turbo', '.vercel'])

/* --------------------------------------------------------------- 基础工具 -- */

function dshHome() {
  return process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
}

function stateDir() {
  return path.join(dshHome(), 'shovel')
}

function stateFile() {
  return path.join(stateDir(), 'state.json')
}

function tokenFile() {
  return path.join(stateDir(), 'token')
}

function opLogFile() {
  return path.join(stateDir(), 'ops.log')
}

function defaultProjectsRoot() {
  return path.join(dshHome(), 'shovel', 'projects')
}

function projectsRoot() {
  return process.env.DSH_SHOVEL_PROJECTS || defaultProjectsRoot()
}

function messageOf(error) {
  return error instanceof Error ? error.message : String(error)
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function nowIso() {
  return new Date().toISOString()
}

function newId() {
  return `p-${randomBytes(4).toString('hex')}`
}

function sha1(text) {
  return createHash('sha1').update(text).digest('hex')
}

/** 目录名：只允许小写字母数字中划线，中文名自动降级成 app-xxxx。 */
function safeSlug(raw, fallbackSeed) {
  const cleaned = String(raw || '').trim().toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  if (cleaned !== '') return cleaned
  return `app-${sha1(String(fallbackSeed || Date.now())).slice(0, 4)}`
}

async function pathExists(target) {
  try {
    await fsp.stat(target)
    return true
  } catch {
    return false
  }
}

async function readText(file) {
  try {
    return await fsp.readFile(file, 'utf8')
  } catch {
    return undefined
  }
}

async function writeText(file, content) {
  await fsp.mkdir(path.dirname(file), { recursive: true })
  await fsp.writeFile(file, content, 'utf8')
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fsp.readFile(file, 'utf8'))
  } catch {
    return fallback
  }
}

async function writeJson(file, value) {
  await fsp.mkdir(path.dirname(file), { recursive: true })
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`
  await fsp.writeFile(tmp, JSON.stringify(value, null, 2), 'utf8')
  await fsp.rename(tmp, file)
}

async function appendLog(entry) {
  try {
    await fsp.mkdir(stateDir(), { recursive: true })
    await fsp.appendFile(opLogFile(), `${nowIso()} ${JSON.stringify(entry)}\n`, 'utf8')
  } catch {
    /* 日志永远不能弄坏主流程 */
  }
}

async function loadOrCreateToken() {
  const existing = await readText(tokenFile())
  if (existing && existing.trim().length >= 32) return existing.trim()
  const token = randomBytes(24).toString('hex')
  await writeText(tokenFile(), token)
  return token
}

function jsonResponse(status, value) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })
}

/* ------------------------------------------------------------- 状态与记录 -- */

async function loadState() {
  const state = await readJson(stateFile(), undefined)
  if (!isRecord(state) || !Array.isArray(state.projects)) {
    return { version: STATE_VERSION, activeId: null, projects: [] }
  }
  return {
    version: STATE_VERSION,
    activeId: state.activeId ?? null,
    projects: state.projects.filter(isRecord),
  }
}

async function saveState(state) {
  state.version = STATE_VERSION
  await writeJson(stateFile(), state)
}

function findProject(state, projectId) {
  const id = projectId && String(projectId).trim()
  if (id) {
    const hit = state.projects.find((project) => project.id === id)
    if (hit) return hit
  }
  if (state.activeId) {
    const active = state.projects.find((project) => project.id === state.activeId)
    if (active) return active
  }
  return state.projects.length === 1 ? state.projects[0] : undefined
}

function requireProject(state, projectId) {
  const project = findProject(state, projectId)
  if (!project) {
    const names = state.projects.map((p) => `${p.id}(${p.name})`).join('、') || '（还没有项目）'
    throw new Error(`找不到项目。现有项目：${names}。先用 shovel_new 新建一个。`)
  }
  return project
}

function summaryOf(project) {
  const stage = STAGES.find((item) => item.index === Number(project.stage)) || STAGES[0]
  const doneTasks = Object.keys(project.tasks || {}).filter((key) => project.tasks[key] === true)
  const totalTasks = STAGES.reduce((sum, item) => sum + item.tasks.length, 0)
  return {
    id: project.id,
    name: project.name,
    dir: project.dir,
    topic: project.topic,
    oneLiner: project.oneLiner || '',
    stage: stage.index,
    stageTitle: stage.title,
    done: doneTasks.length,
    total: totalTasks,
    acceptance: project.acceptance && project.acceptance.decidedAt ? 'recorded' : 'pending',
    updatedAt: project.updatedAt,
  }
}

/* ------------------------------------------------------------------ 脚手架 -- */

async function copyDir(from, to) {
  await fsp.cp(from, to, { recursive: true, force: false, errorOnExist: false })
}

async function hashBaseline(projectDir) {
  const baseline = {}
  const roots = ['src/core', 'src/adapters/types.ts', 'src/adapters/mock.ts']
  for (const relative of roots) {
    const absolute = path.join(projectDir, relative)
    if (!(await pathExists(absolute))) continue
    const stat = await fsp.stat(absolute)
    if (stat.isFile()) {
      baseline[relative.replace(/\\/g, '/')] = sha1(await fsp.readFile(absolute))
      continue
    }
    for (const file of await walkFiles(absolute, 200)) {
      const key = path.relative(projectDir, file).replace(/\\/g, '/')
      baseline[key] = sha1(await fsp.readFile(file))
    }
  }
  return baseline
}

async function walkFiles(dir, limit = 400) {
  const out = []
  const stack = [dir]
  while (stack.length > 0 && out.length < limit) {
    const current = stack.pop()
    let entries = []
    try {
      entries = await fsp.readdir(current, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (out.length >= limit) break
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue
        stack.push(full)
      } else if (entry.isFile()) {
        out.push(full)
      }
    }
  }
  return out
}

function projectReadme(project) {
  const lines = [
    `# ${project.name}`,
    '',
    project.oneLiner ? `> ${project.oneLiner}` : '> 一句话说明这次要做的东西（在 README 里补上）。',
    '',
    '## 这是什么',
    '',
    '由「全栈铲子」插件生成的骨架。**不要从零开始写代码**：骨架规格在 `SPEC.md`，',
    '按 `docs/提示词包.md` 里 P0 → P8 的顺序一条一条发给 AI Coding 工具，你只负责验收。',
    '',
    '## 怎么跑',
    '',
    '```bash',
    'pnpm install',
    'pnpm dev          # 打开 http://localhost:3000，先看 mock 链路',
    '```',
    '',
    '`.env.local` 已经生成好了（AI key 可以先空着，骨架用 mock 引擎跑通全链路）。',
    '',
    '## 怎么验（第 1 步的四件事）',
    '',
    '- [ ] 页面能打开、样式正常',
    '- [ ] 输入 → 点生成 → 看到 mock 结果',
    '- [ ] 失败时页面有明确提示，不白屏',
    '- [ ] `pnpm typecheck` 通过',
    '',
    '## 本次项目信息',
    '',
    '| 项 | 值 |',
    '|---|---|',
    `| 产品名 | ${project.name} |`,
    `| 目录名 / apps 名 | ${project.topic} |`,
    `| 目标用户 | ${project.targetUser || '（待填，见 docs/本项目信息.md）'} |`,
    `| 主交互 | ${project.interaction || '（待填）'} |`,
    `| 主引擎 | ${project.primaryAdapter || 'mock'} |`,
    `| 备用引擎 | ${project.secondaryAdapter || '（未设）'} |`,
    `| 单次成本上限 | ${project.maxCost ?? 0.5} 元 |`,
    '',
    '## 文档',
    '',
    '- `SPEC.md` —— 骨架规格，发给 AI 的第一句话（不许改内容，只跟版本号）',
    '- `docs/01_全栈开发SOP.md` —— 九层选型、两层架构、六步上线',
    '- `docs/02_第一次跑通.md` —— 手把手与报错速查',
    '- `docs/03_成本与避坑.md` —— 免费额度、Fallback、六条红线',
    '- `docs/提示词包.md` —— P0–P8 已按本项目填好变量，整段复制给 AI',
    '- `docs/上线验收清单.md` —— 30 条，不勾完别对外发链接',
    '- `docs/新项目复用清单.md` —— 下个项目复制骨架后要改的 8 处',
    '',
    '## 上线配置清单（第 4 步照着勾）',
    '',
    '- [ ] Vercel 导入仓库，Production / Preview 两套环境变量分开填',
    '- [ ] Clerk 后台加入线上域名与回调地址',
    '- [ ] 支付后台 Webhook URL 换成 `https://<你的域名>/api/billing/webhook`，验签密钥与 Vercel 里一致',
    '- [ ] Supabase 生产项目与本地不是同一个',
    '- [ ] 域名在 Vercel → Domains 绑定，等 DNS 生效',
    '- [ ] 线上把第一步的四件事再走一遍',
    '',
    '---',
    '',
    `由「全栈铲子」生成于 ${project.createdAt}。下次开工直接在本插件里点「新建项目」。`,
    '',
  ]
  return lines.join('\n')
}

function projectInfoDoc(project) {
  return [
    `# 本项目信息（给 AI 的上下文）`,
    '',
    `> 开新会话、或 AI 忘了上下文时，把这份文件一起贴给它。`,
    '',
    `- 产品名：${project.name}`,
    `- 目录名 / apps 名：${project.topic}`,
    `- 一句话主题：${project.oneLiner || '（待填）'}`,
    `- 目标用户：${project.targetUser || '（待填）'}`,
    `- 主交互：${project.interaction || '（待填）'}`,
    `- 主引擎：${project.primaryAdapter || 'mock'}；备用：${project.secondaryAdapter || '（未设）'}`,
    `- 单次成本上限：${project.maxCost ?? 0.5} 元`,
    `- 项目目录：${project.dir}`,
    `- 创建时间：${project.createdAt}`,
    '',
  ].join('\n')
}

function applyVarsToEnv(text, project) {
  return text
    .replace(/^NEXT_PUBLIC_APP_NAME=.*$/m, `NEXT_PUBLIC_APP_NAME=${project.topic}`)
    .replace(/^NEXT_PUBLIC_APP_URL=.*$/m, 'NEXT_PUBLIC_APP_URL=http://localhost:3000')
    .replace(/^PRIMARY_ADAPTER=.*$/m, `PRIMARY_ADAPTER=${project.primaryAdapter || 'mock'}`)
    .replace(/^SECONDARY_ADAPTER=.*$/m, `SECONDARY_ADAPTER=${project.secondaryAdapter || ''}`)
    .replace(/^MAX_COST_PER_CALL=.*$/m, `MAX_COST_PER_CALL=${project.maxCost ?? 0.5}`)
}

function projectVars(project) {
  return {
    name: project.name,
    topic: project.topic,
    dir: project.dir,
    oneLiner: project.oneLiner,
    targetUser: project.targetUser,
    interaction: project.interaction,
    primaryAdapter: project.primaryAdapter,
    secondaryAdapter: project.secondaryAdapter,
    maxCost: project.maxCost,
    seoSource: project.seoSource,
  }
}

async function renderAllPrompts(project) {
  const vars = projectVars(project)
  const spec = (await readText(path.join(project.dir, 'SPEC.md'))) || (await readText(path.join(ASSETS, 'docs', 'SPEC.md'))) || ''
  const out = []
  out.push(['开工三件套（SPEC + P0 + P1）', kickoff(spec, vars)])
  for (const prompt of PROMPTS) {
    out.push([`${prompt.id} · ${prompt.title}`, prompt.body(vars)])
  }
  return out
}

async function createProject(input) {
  const state = await loadState()
  const name = String(input.name || '').trim()
  if (name === '') throw new Error('name 不能为空：给项目起个中文名就行，例如「小红书封面生成器」')

  const topic = safeSlug(input.topic || '', name)
  if (state.projects.some((project) => project.topic === topic)) {
    throw new Error(`目录名 ${topic} 已被另一个项目占用，换一个 topic（英文短词）`)
  }

  const root = input.dir ? path.resolve(String(input.dir)) : path.join(projectsRoot(), topic)
  const exists = await pathExists(root)
  if (exists) {
    const stat = await fsp.stat(root)
    if (!stat.isDirectory()) throw new Error(`${root} 已存在且不是目录`)
    const entries = await fsp.readdir(root)
    if (entries.length > 0 && input.adopt !== true) {
      throw new Error(`目录已存在且非空：${root}。换一个 dir，或传 adopt=true 把已有项目纳管。`)
    }
  }

  const project = {
    id: newId(),
    name,
    topic,
    dir: root,
    oneLiner: String(input.oneLiner || '').trim(),
    targetUser: String(input.targetUser || '').trim(),
    interaction: String(input.interaction || '').trim(),
    primaryAdapter: String(input.primaryAdapter || 'mock').trim(),
    secondaryAdapter: String(input.secondaryAdapter || '').trim(),
    maxCost: Number.isFinite(Number(input.maxCost)) ? Number(input.maxCost) : 0.5,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    stage: 1,
    tasks: { scaffold: true },
    acceptance: {},
    economics: {},
    baseline: {},
    notes: [],
  }

  if (input.adopt === true) {
    if (!(await pathExists(path.join(root, 'SPEC.md')))) {
      throw new Error(`${root} 里没有 SPEC.md，不像骨架目录；纳管前先确认路径`)
    }
  } else {
    await fsp.mkdir(path.dirname(root), { recursive: true })
    await copyDir(SKELETON, root)

    // 文档与模板（这些都是「不随产品变」的管理资产）
    const docsDir = path.join(root, 'docs')
    await fsp.mkdir(docsDir, { recursive: true })
    for (const file of await fsp.readdir(path.join(ASSETS, 'docs'))) {
      if (!file.endsWith('.md')) continue
      const target = file === '提示词包-原文.md' ? '提示词包-原文.md' : file
      await fsp.copyFile(path.join(ASSETS, 'docs', file), path.join(docsDir, target))
    }
    for (const file of await fsp.readdir(path.join(ASSETS, 'templates'))) {
      await fsp.copyFile(path.join(ASSETS, 'templates', file), path.join(docsDir, file))
    }
    await fsp.copyFile(path.join(ASSETS, 'docs', 'SPEC.md'), path.join(root, 'SPEC.md'))

    // 环境变量：从模板生成 .env.local（.env.example 保留给仓库）
    const source = (await readText(path.join(ASSETS, 'templates', 'env.example'))) || ''
    await writeText(path.join(root, '.env.example'), source)
    await writeText(path.join(root, '.env.local'), applyVarsToEnv(source, project))

    // 提示词按项目变量渲染一份，离线也能贴
    const promptsDir = path.join(root, 'docs', 'prompts')
    await fsp.mkdir(promptsDir, { recursive: true })
    for (const [title, body] of await renderAllPrompts(project)) {
      const file = title.replace(/[\\/:*?"<>|]/g, '-') + '.md'
      await writeText(path.join(promptsDir, file), `${body}\n`)
    }

    // apps/ 目录先占位（测试与目录约定都依赖它）
    await fsp.mkdir(path.join(root, 'src', 'apps', topic), { recursive: true })
    await writeText(
      path.join(root, 'src', 'apps', topic, 'README.md'),
      `# apps/${topic}\n\n本次产品的页面与业务接口放这里（page.tsx / route.ts）。\n在 P1 之前它是空的——骨架的演示页在 src/app/page.tsx。\n`,
    )
  }

  await writeText(path.join(root, 'README.md'), projectReadme(project))
  await writeText(path.join(root, 'docs', '本项目信息.md'), projectInfoDoc(project))

  project.baseline = await hashBaseline(root)
  state.projects.push(project)
  state.activeId = project.id
  await saveState(state)
  await appendLog({ action: 'project.create', id: project.id, dir: root, adopted: input.adopt === true })
  return { project: summaryOf(project), dir: root }
}

/* -------------------------------------------------------------------- 体检 -- */

function parseEnv(text) {
  const map = {}
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim()
    if (line === '' || line.startsWith('#')) continue
    const at = line.indexOf('=')
    if (at <= 0) continue
    const key = line.slice(0, at).trim()
    let value = line.slice(at + 1).trim()
    // 行尾注释：只有在 # 前面是空白时才算注释（避免切掉值里的 #）
    const hash = value.indexOf('#')
    if (hash === 0) value = ''
    else if (hash > 0 && /\s/.test(value[hash - 1])) value = value.slice(0, hash).trim()
    map[key] = value.replace(/^['"]|['"]$/g, '')
  }
  return map
}

function isPlaceholder(value) {
  const text = String(value || '').trim()
  if (text === '') return true
  if (/xxxx/i.test(text)) return true
  return /^(your-|placeholder|example|none|null|<|待填|sk_test_xxxx|pk_test_xxxx)/i.test(text)
}

async function runSimpleCommand(command, args, cwd) {
  return new Promise((resolve) => {
    const child = execFile(command, args, { cwd, timeout: 8000, windowsHide: true }, (error, stdout, stderr) => {
      resolve({
        ok: error === null,
        code: error && typeof error.code === 'number' ? error.code : error === null ? 0 : 1,
        out: String(stdout || '').trim(),
        err: String(stderr || '').trim(),
      })
    })
    if (child && typeof child.on === 'function') child.on('error', () => resolve({ ok: false, code: -1, out: '', err: 'spawn failed' }))
  })
}

/**
 * 验收命令探测：Windows 上 pnpm / corepack 是 .cmd shim，execFile 直接起不来，
 * 必须经 cmd /c 才认（否则会误报「pnpm 不可用」）。
 */
async function runProbe(command, args, cwd) {
  if (process.platform === 'win32') {
    return runSimpleCommand(process.env.ComSpec || 'cmd.exe', ['/c', command, ...args], cwd)
  }
  return runSimpleCommand(command, args, cwd)
}

function checkOf(id, title, status, detail, fix, group) {
  return { id, title, status, detail: detail || '', fix: fix || '', group: group || '骨架' }
}

async function verifyProject(project) {
  const checks = []
  const dir = project.dir
  if (!(await pathExists(dir))) {
    return {
      ok: false,
      score: 0,
      checks: [checkOf('dir', '项目目录存在', 'fail', `目录不存在：${dir}`, '确认项目路径，或在本插件里重新纳管。', '骨架')],
      counts: { pass: 0, warn: 0, fail: 1, skip: 0 },
    }
  }

  // 1) 关键文件
  const required = [
    ['SPEC.md', '骨架规格（发给 AI 的第一句话）'],
    ['.env.example', '环境变量模板'],
    ['.env.local', '本地环境变量'],
    ['.gitignore', 'Git 忽略清单'],
    ['README.md', '本次产品说明'],
    ['src/adapters/types.ts', '统一适配器接口（冻结区）'],
    ['src/adapters/mock.ts', '假引擎（零 key 跑通全链路）'],
    ['src/adapters/index.ts', '降级链组装'],
    ['src/core/fallback/run-with-fallback.ts', '降级执行器'],
    ['supabase/migrations/0001_init.sql', '建表 SQL'],
    ['docs/提示词包-原文.md', '提示词包原文'],
    ['docs/上线验收清单.md', '30 条验收清单'],
  ]
  const missing = []
  for (const [relative, label] of required) {
    if (!(await pathExists(path.join(dir, relative)))) missing.push(`${relative}（${label}）`)
  }
  checks.push(checkOf(
    'files', '关键文件齐全',
    missing.length === 0 ? 'pass' : 'fail',
    missing.length === 0 ? `${required.length} 个关键文件都在` : `缺：${missing.join('；')}`,
    '在本插件里重新新建项目，或从 assets 里把缺的文件补回来。',
  ))

  // 2) .gitignore 三件套
  const gitignore = (await readText(path.join(dir, '.gitignore'))) || ''
  const ignores = ['.env.local', 'node_modules', '.next']
  const absent = ignores.filter((token) => !gitignore.includes(token))
  checks.push(checkOf(
    'gitignore', '.gitignore 覆盖密钥与产物',
    absent.length === 0 ? 'pass' : 'fail',
    absent.length === 0 ? '.env.local / node_modules / .next 都已忽略' : `缺：${absent.join('、')}`,
    '往 .gitignore 里补上缺的行，否则密钥可能被提交。',
  ))

  // 3) env 填充度
  const envText = (await readText(path.join(dir, '.env.local'))) || ''
  const env = parseEnv(envText)
  const groups = new Map()
  for (const item of ENV_LEVELS) {
    const group = groups.get(item.level) || { level: item.level, filled: 0, total: 0, missing: [] }
    group.total += 1
    const value = env[item.key]
    if (value !== undefined && !isPlaceholder(value)) group.filled += 1
    else group.missing.push(item.key)
    groups.set(item.level, group)
  }
  const base = groups.get('base') || { filled: 0, total: 0, missing: [] }
  checks.push(checkOf(
    'env-base', '基础环境变量',
    base.filled >= 2 ? 'pass' : 'fail',
    `base 已填 ${base.filled}/${base.total}${base.missing.length ? `，缺 ${base.missing.join('、')}` : ''}`,
    '在 .env.local 里填 NEXT_PUBLIC_APP_NAME / NEXT_PUBLIC_APP_URL（其余层级按需逐步填）。',
  ))
  const db = groups.get('db')
  const auth = groups.get('auth')
  const engine = groups.get('engine')
  const phaseNote = []
  if (db) phaseNote.push(`数据库 ${db.filled}/${db.total}`)
  if (auth) phaseNote.push(`登录 ${auth.filled}/${auth.total}`)
  if (engine) phaseNote.push(`引擎 ${engine.filled}/${engine.total}`)
  const readyMock = engine && engine.filled === 0
  checks.push(checkOf(
    'env-phases', '各层 key 填充进度',
    'warn',
    `${phaseNote.join(' · ')}${readyMock ? '（引擎还没填 → 正走 mock，这是第 1 步的正常状态）' : ''}`,
    '第 1 步只填 base；P2 填登录、P3 填数据库、P4 填支付、P5 才填引擎 key。别一次全填，出问题难定位。',
  ))

  // 4) NEXT_PUBLIC_ 里塞了服务端密钥
  const leakedPublic = Object.entries(env)
    .filter(([key, value]) => key.startsWith('NEXT_PUBLIC_') && value !== '' && !isPlaceholder(value))
    .filter(([key]) => /SECRET|SERVICE_ROLE|_KEY$|_TOKEN$|PASSWORD/i.test(key) && !/PUBLISHABLE/i.test(key))
  checks.push(checkOf(
    'public-secret', '服务端密钥没混进 NEXT_PUBLIC_',
    leakedPublic.length === 0 ? 'pass' : 'fail',
    leakedPublic.length === 0 ? '没有发现' : `危险：${leakedPublic.map(([key]) => key).join('、')}`,
    '任何 NEXT_PUBLIC_ 变量都会进浏览器。把这些键去掉 NEXT_PUBLIC_ 前缀，只在服务端引用。',
  ))

  // 5) core/ 冻结区是否被改
  const baseline = project.baseline || {}
  const changed = []
  const deleted = []
  for (const [relative, hash] of Object.entries(baseline)) {
    const absolute = path.join(dir, relative)
    if (!(await pathExists(absolute))) {
      deleted.push(relative)
      continue
    }
    if (sha1(await fsp.readFile(absolute)) !== hash) changed.push(relative)
  }
  const frozenOk = changed.length === 0 && deleted.length === 0
  checks.push(checkOf(
    'frozen', '冻结区（core/ + 适配器契约）没被改',
    frozenOk ? 'pass' : 'fail',
    frozenOk
      ? `${Object.keys(baseline).length} 个冻结文件与基线一致`
      : `被改：${changed.join('、') || '—'}${deleted.length ? `；被删：${deleted.join('、')}` : ''}`,
    '骨架被改一次，复利就断一次。让 AI 回滚这些文件；确实要升级 core/，按 docs/目录结构.md 的流程走并升 SPEC 版本。',
  ))

  // 6) 降级链末尾必须还是 mock
  const adapterIndex = (await readText(path.join(dir, 'src/adapters/index.ts'))) || ''
  const chainMatch = adapterIndex.match(/ADAPTERS[^=]*=\s*\[([^\]]*)\]/)
  const chainItems = chainMatch ? chainMatch[1].split(',').map((item) => item.trim()).filter(Boolean) : []
  const chainOk = chainItems.length > 0 && /mock/i.test(chainItems[chainItems.length - 1])
  checks.push(checkOf(
    'chain', '降级链最后一级是 mock',
    chainOk ? 'pass' : 'fail',
    chainItems.length === 0 ? '没找到 ADAPTERS 数组' : `链：[${chainItems.join(', ')}]`,
    '降级链末尾永远挂 mock（零 key 也能跑通 + 引擎全挂时给用户明确反馈）。',
  ))

  // 7) package.json 的验收命令
  const pkg = await readJson(path.join(dir, 'package.json'), undefined)
  const scripts = isRecord(pkg) && isRecord(pkg.scripts) ? pkg.scripts : {}
  const wanted = ['dev', 'build', 'typecheck', 'test']
  const missingScripts = wanted.filter((key) => typeof scripts[key] !== 'string')
  checks.push(checkOf(
    'scripts', '验收四命令可用',
    missingScripts.length === 0 ? 'pass' : 'warn',
    missingScripts.length === 0 ? wanted.map((key) => `pnpm ${key}`).join(' / ') : `package.json 缺脚本：${missingScripts.join('、')}`,
    '标准验收是 pnpm typecheck && pnpm lint && pnpm test && pnpm build 四条全绿，缺哪条补哪条。',
  ))

  // 8) 密钥泄漏扫描（排除 .env.local，它本来就该有）
  const findings = []
  const files = await walkFiles(dir, 300)
  for (const file of files) {
    const base = path.basename(file)
    if (base === '.env.local' || base === 'env.example' || base === '.env.example') continue
    const relative = path.relative(dir, file).replace(/\\/g, '/')
    if (relative.startsWith('docs/')) continue
    let stat
    try {
      stat = await fsp.stat(file)
    } catch {
      continue
    }
    if (stat.size > 256 * 1024) continue
    const text = await readText(file)
    if (text === undefined) continue
    for (const pattern of SECRET_PATTERNS) {
      if (!pattern.re.test(text)) continue
      const hitLine = text.split(/\r?\n/).findIndex((line) => pattern.re.test(line))
      const lineText = hitLine >= 0 ? text.split(/\r?\n/)[hitLine].trim() : ''
      if (/(your-|xxxx|placeholder|example|待填|<)/i.test(lineText)) continue
      findings.push(`${relative}:${hitLine + 1}（${pattern.name}）`)
    }
  }
  checks.push(checkOf(
    'secrets', '仓库里没有明文密钥',
    findings.length === 0 ? 'pass' : 'fail',
    findings.length === 0 ? `扫了 ${files.length} 个文件，没发现密钥特征` : `可疑：${findings.slice(0, 6).join('；')}`,
    '删掉硬编码密钥，改读环境变量；已经提交过的密钥要立刻作废重发。',
  ))

  // 9) git：.env.local 有没有被跟踪 / remote 是不是本项目
  if (await pathExists(path.join(dir, '.git'))) {
    const inside = await runProbe('git', ['rev-parse', '--is-inside-work-tree'], dir)
    if (inside.ok && inside.out.includes('true')) {
      const tracked = await runProbe('git', ['ls-files', '--error-unmatch', '.env.local'], dir)
      checks.push(checkOf(
        'git-env', '.env.local 没被 Git 跟踪',
        tracked.ok ? 'fail' : 'pass',
        tracked.ok ? '.env.local 已被 Git 跟踪（密钥会进仓库）' : '未被跟踪',
        'git rm --cached .env.local，并确认 .gitignore 里有 .env.local。',
      ))
      const remote = await runProbe('git', ['remote', '-v'], dir)
      const url = (remote.out.split(/\r?\n/)[0] || '').trim()
      const matches = url.toLowerCase().includes(String(project.topic).toLowerCase()) || url.toLowerCase().includes(String(project.name).toLowerCase())
      checks.push(checkOf(
        'git-remote', 'Git remote 指向本项目',
        url === '' ? 'warn' : matches ? 'pass' : 'warn',
        url === '' ? '还没配 remote（第 4 步才需要）' : url,
        '推之前先看清 remote 是哪个仓库：推错仓是真实发生过的翻车（密钥泄漏 + 回滚麻烦）。',
      ))
    } else {
      checks.push(checkOf('git-env', 'Git 状态', 'skip', 'git 不可用，跳过', '安装 git 后再验。'))
    }
  } else {
    checks.push(checkOf('git-env', 'Git 仓库', 'warn', '还没 git init（第 4 步才需要）', '第 4 步部署前再 init 即可。'))
  }

  // 10) 第 2 步之后：apps/<topic> 里有没有真页面
  const appsDir = path.join(dir, 'src', 'apps', project.topic)
  const hasPage = await pathExists(path.join(appsDir, 'page.tsx'))
  checks.push(checkOf(
    'apps', `apps/${project.topic}/ 落地页`,
    hasPage ? 'pass' : 'warn',
    hasPage ? 'page.tsx 已就位' : '还没有 page.tsx（P1 跑完才有）',
    '把「开工三件套」发给 AI，让它只改 apps/ 与 adapters/ 生成落地页。',
  ))

  // 11) 本机工具链
  const node = await runProbe('node', ['-v'], dir)
  const pnpm = await runProbe('pnpm', ['-v'], dir)
  const git = await runProbe('git', ['--version'], dir)
  checks.push(checkOf(
    'toolchain', '本机工具链',
    node.ok && pnpm.ok ? 'pass' : 'warn',
    `node ${node.ok ? node.out : '不可用'} · pnpm ${pnpm.ok ? pnpm.out : '不可用'} · git ${git.ok ? git.out.replace('git version ', '') : '不可用'}`,
    'pnpm 没装就跑 corepack enable && corepack prepare pnpm@latest --activate；git 没装就装 Git for Windows。',
  ))

  const counts = { pass: 0, warn: 0, fail: 0, skip: 0 }
  for (const check of checks) counts[check.status] = (counts[check.status] || 0) + 1
  const total = counts.pass + counts.warn + counts.fail
  const score = total === 0 ? 0 : Math.round(((counts.pass + counts.warn * 0.5) / total) * 100)
  return { ok: counts.fail === 0, score, counts, checks }
}

/* -------------------------------------------------------------- 验收与算账 -- */

function acceptanceView(project) {
  const results = isRecord(project.acceptance && project.acceptance.results) ? project.acceptance.results : {}
  const items = CHECKLIST.map((item) => ({
    ...item,
    result: typeof results[item.id] === 'string' ? results[item.id] : 'unset',
  }))
  const fails = items.filter((item) => item.result === 'fail')
  const hardFails = fails.filter((item) => item.hard)
  const unset = items.filter((item) => item.result === 'unset')
  const complete = unset.length === 0
  const verdict = fails.length > 0 ? 'blocked' : complete ? 'allowed' : 'incomplete'
  return {
    items,
    results,
    counts: {
      pass: items.filter((item) => item.result === 'pass').length,
      fail: fails.length,
      na: items.filter((item) => item.result === 'na').length,
      unset: unset.length,
      hardFail: hardFails.length,
    },
    // 只有「30 条全记录 + 一条不通过都没有」才允许上线（SOP：不勾完别对外发链接）
    allowed: verdict === 'allowed',
    verdict,
    complete,
    hardFails: hardFails.map((item) => item.id),
    undecidedHard: unset.filter((item) => item.hard).map((item) => item.id),
    decidedAt: project.acceptance && project.acceptance.decidedAt,
    note: project.acceptance && project.acceptance.note,
  }
}

async function recordAcceptance(project, results, note) {
  if (!isRecord(results)) throw new Error('results 必须是 { 条目ID: "pass"|"fail"|"na" } 形式')
  const unknown = Object.keys(results).filter((key) => !CHECKLIST.some((item) => item.id === key))
  if (unknown.length > 0) throw new Error(`未知清单条目：${unknown.join('、')}（合法值是 A1…H2）`)
  const invalid = Object.entries(results).filter(([, value]) => !['pass', 'fail', 'na'].includes(String(value)))
  if (invalid.length > 0) throw new Error(`状态只能是 pass / fail / na，收到：${invalid.map(([key]) => key).join('、')}`)
  project.acceptance = {
    results: { ...(project.acceptance && project.acceptance.results), ...results },
    decidedAt: nowIso(),
    note: typeof note === 'string' ? note : '',
  }
  project.updatedAt = nowIso()
  return acceptanceView(project)
}

/* -------------------------------------------------------------------- 动作 -- */

async function actionState() {
  const state = await loadState()
  const projects = state.projects.map((project) => ({
    ...summaryOf(project),
    vars: projectVars(project),
    acceptanceView: acceptanceView(project),
  }))
  return {
    projects,
    activeId: state.activeId,
    projectsRoot: projectsRoot(),
    stages: STAGES,
    checklist: CHECKLIST,
    envLevels: ENV_LEVELS,
    prompts: promptIndex(),
    docs: [
      { name: '01_全栈开发SOP.md', title: '01 全栈开发 SOP（核心方案）' },
      { name: '02_第一次跑通.md', title: '02 第一次跑通（手把手）' },
      { name: '03_成本与避坑.md', title: '03 成本与避坑（六条红线）' },
      { name: 'SPEC.md', title: 'SPEC 骨架规格（给 AI 的第一句话）' },
      { name: '目录结构.md', title: '目录结构（冻结区 / 可换区）' },
      { name: '上线验收清单.md', title: '30 条上线验收清单' },
      { name: '新项目复用清单.md', title: '复制骨架后必改 8 处' },
      { name: '依赖安装清单.md', title: '依赖安装清单' },
      { name: '提示词包-原文.md', title: '提示词包（原文 · P0–P8）' },
    ],
  }
}

async function actionProjectCreate(payload) {
  const result = await createProject(payload)
  const state = await loadState()
  const project = requireProject(state, result.project.id)
  return {
    ...result,
    status: await actionState(),
    next: {
      title: '第 1 步：先把 mock 链路跑通',
      commands: ['pnpm install', 'pnpm dev'],
      promptId: 'kickoff',
      tasks: STAGES[1].tasks,
      confirm: project.id,
    },
  }
}

async function actionProjectUpdate(payload) {
  const state = await loadState()
  const project = requireProject(state, payload.projectId)
  const fields = ['name', 'oneLiner', 'targetUser', 'interaction', 'primaryAdapter', 'secondaryAdapter', 'seoSource']
  for (const field of fields) {
    if (typeof payload[field] === 'string') project[field] = payload[field].trim()
  }
  if (payload.maxCost !== undefined && Number.isFinite(Number(payload.maxCost))) project.maxCost = Number(payload.maxCost)
  if (payload.stage !== undefined && STAGES.some((item) => item.index === Number(payload.stage))) project.stage = Number(payload.stage)
  if (typeof payload.note === 'string' && payload.note.trim() !== '') {
    project.notes = Array.isArray(project.notes) ? project.notes : []
    project.notes.push({ at: nowIso(), text: payload.note.trim() })
  }
  project.updatedAt = nowIso()
  await saveState(state)
  await appendLog({ action: 'project.update', id: project.id, fields: Object.keys(payload) })
  return { project: summaryOf(project) }
}

async function actionProjectSelect(payload) {
  const state = await loadState()
  const project = requireProject(state, payload.projectId)
  state.activeId = project.id
  await saveState(state)
  return { activeId: project.id }
}

async function actionPromptGet(payload) {
  const state = await loadState()
  const project = requireProject(state, payload.projectId)
  const id = String(payload.promptId || 'kickoff')
  const vars = projectVars(project)
  if (id === 'spec') {
    const text = (await readText(path.join(project.dir, 'SPEC.md'))) || (await readText(path.join(ASSETS, 'docs', 'SPEC.md'))) || ''
    return { id, title: 'SPEC 骨架规格', text }
  }
  if (id === 'kickoff') {
    const spec = (await readText(path.join(project.dir, 'SPEC.md'))) || ''
    return { id, title: '开工三件套（SPEC + P0 + P1）', text: kickoff(spec, vars) }
  }
  const prompt = PROMPTS.find((item) => item.id === id)
  if (!prompt) throw new Error(`未知提示词 ${id}，可用：kickoff / spec / ${PROMPTS.map((item) => item.id).join(' / ')}`)
  return { id, title: `${prompt.id} · ${prompt.title}`, text: prompt.body(vars) }
}

async function actionTaskSet(payload) {
  const state = await loadState()
  const project = requireProject(state, payload.projectId)
  if (payload.stage !== undefined && STAGES.some((item) => item.index === Number(payload.stage))) {
    project.stage = Number(payload.stage)
  }
  if (typeof payload.taskId === 'string' && payload.taskId !== '') {
    project.tasks = isRecord(project.tasks) ? project.tasks : {}
    project.tasks[payload.taskId] = payload.done === true
    // 一条阶段内全部勾完 → 自动前进到下一步（只前进，不回退）
    const stage = STAGES.find((item) => item.tasks.some((task) => task.id === payload.taskId))
    if (stage && stage.tasks.every((task) => project.tasks[task.id] === true)) {
      project.stage = Math.max(Number(project.stage) || 0, Math.min(stage.index + 1, STAGES.length - 1))
    }
  }
  project.updatedAt = nowIso()
  await saveState(state)
  const done = Object.keys(project.tasks || {}).filter((key) => project.tasks[key] === true)
  return {
    project: summaryOf(project),
    stage: project.stage,
    stageTasks: (STAGES.find((item) => item.index === Number(project.stage)) || STAGES[0]).tasks.map((task) => ({
      ...task,
      done: done.includes(task.id),
    })),
  }
}

async function actionVerify(payload) {
  const state = await loadState()
  const project = requireProject(state, payload.projectId)
  const result = await verifyProject(project)
  project.lastVerify = { at: nowIso(), ok: result.ok, score: result.score, fail: result.counts.fail }
  project.updatedAt = nowIso()
  await saveState(state)
  await appendLog({ action: 'verify', id: project.id, ok: result.ok, score: result.score })
  return { ...result, project: summaryOf(project) }
}

async function actionAccept(payload) {
  const state = await loadState()
  const project = requireProject(state, payload.projectId)
  if (payload.results !== undefined) {
    const view = await recordAcceptance(project, payload.results, payload.note)
    await saveState(state)
    await appendLog({ action: 'accept', id: project.id, allowed: view.allowed })
    return view
  }
  return acceptanceView(project)
}

async function actionEconomics(payload) {
  const state = await loadState()
  const project = requireProject(state, payload.projectId)
  const merged = { ...(isRecord(project.economics && project.economics.input) ? project.economics.input : {}) }
  for (const key of ['priceYuan', 'enginePerCall', 'callsPerTask', 'storagePerTask', 'paymentPct', 'payRatePct', 'cacYuan']) {
    if (payload[key] !== undefined && payload[key] !== '') merged[key] = payload[key]
  }
  if (payload.priceYuan === undefined && payload.enginePerCall === undefined && project.economics && project.economics.input) {
    return { economics: project.economics, stored: project.economics.input }
  }
  const result = computeEconomics(merged)
  project.economics = { input: result.input, result, at: nowIso() }
  project.updatedAt = nowIso()
  await saveState(state)
  return { economics: result, project: summaryOf(project) }
}

async function actionDocGet(payload) {
  const name = String(payload.name || '')
  if (!/^[\w\u4e00-\u9fa5.\-]+$/.test(name)) throw new Error('文档名不合法')
  const candidates = [path.join(ASSETS, 'docs', name), path.join(ASSETS, 'templates', name)]
  for (const candidate of candidates) {
    const text = await readText(candidate)
    if (text !== undefined) return { name, text }
  }
  throw new Error(`没有这份文档：${name}`)
}

const ACTIONS = {
  state: () => actionState(),
  'project.create': actionProjectCreate,
  'project.update': actionProjectUpdate,
  'project.select': actionProjectSelect,
  'prompt.get': actionPromptGet,
  'task.set': actionTaskSet,
  'verify.run': actionVerify,
  'accept.save': actionAccept,
  'economics.compute': actionEconomics,
  'doc.get': actionDocGet,
}

async function dispatch(payload) {
  const action = payload && typeof payload.action === 'string' ? payload.action : ''
  const handler = ACTIONS[action]
  if (!handler) throw new Error(`未知动作：${action || '(空)'}`)
  return handler(payload || {})
}

/* ------------------------------------------------------------------ 工具层 -- */

function textOutput(render) {
  return { schema: { type: 'string' }, render: (args, value) => [{ type: 'text', text: render(value) }] }
}

async function toolStatus(args) {
  const state = await loadState()
  if (state.projects.length === 0) {
    return [
      '【全栈铲子】还没有项目。',
      `项目默认落在：${projectsRoot()}`,
      '',
      '下一步：调 shovel_new 建第一个项目（只要给 name，其余可留空），',
      '然后按返回的「第 1 步」跑 pnpm install / pnpm dev，先用 mock 把链路跑通。',
      '界面入口：左侧栏底部「全栈铲子」按钮。',
    ].join('\n')
  }
  const project = findProject(state, args && args.projectId)
  const lines = []
  lines.push(`【全栈铲子】共 ${state.projects.length} 个项目，当前：${project.name}（${project.id}）`)
  lines.push(`目录：${project.dir}`)
  const stage = STAGES.find((item) => item.index === Number(project.stage)) || STAGES[0]
  const done = project.tasks || {}
  lines.push('')
  lines.push(`进度：第 ${stage.index} 步 · ${stage.title} —— ${stage.summary}`)
  for (const item of STAGES) {
    const stageDone = item.tasks.filter((task) => done[task.id] === true).length
    const mark = item.index < stage.index ? '✓' : item.index === stage.index ? '▶' : '·'
    lines.push(`  ${mark} ${item.title} (${stageDone}/${item.tasks.length})`)
  }
  lines.push('')
  lines.push(`本步任务：`)
  for (const task of stage.tasks) lines.push(`  [${done[task.id] === true ? 'x' : ' '}] ${task.id} · ${task.label}`)
  if (project.lastVerify) {
    lines.push('')
    lines.push(`上次体检：${project.lastVerify.ok ? '通过' : `有 ${project.lastVerify.fail} 项不通过`}（得分 ${project.lastVerify.score}）· ${project.lastVerify.at}`)
  }
  const view = acceptanceView(project)
  lines.push(`验收：通过 ${view.counts.pass} · 不通过 ${view.counts.fail} · 不适用 ${view.counts.na} · 未记录 ${view.counts.unset}${view.decidedAt ? ` · 记录于 ${view.decidedAt}` : ''}`)
  if (project.notes && project.notes.length > 0) lines.push(`备注：${project.notes[project.notes.length - 1].text}`)
  lines.push('')
  lines.push('下一步动作：shovel_verify（体检）→ shovel_prompt（取提示词交给 AI）→ shovel_task（勾进度）')
  return lines.join('\n')
}

async function toolNew(args) {
  const payload = isRecord(args) ? args : {}
  const result = await createProject(payload)
  const project = result.project
  const lines = [
    `已生成骨架：${project.name}`,
    `目录：${result.dir}`,
    '',
    '已就位：SPEC.md / .env.example / .env.local / .gitignore / package.json',
    '        src/adapters/{types,mock,index}.ts（统一接口 + 假引擎 + 降级链）',
    '        src/core/fallback/run-with-fallback.ts（超时/成本阀/降级/留痕）',
    '        src/app/{layout,page}.tsx + api/mock-generate/route.ts（零 key 演示页）',
    '        supabase/migrations/0001_init.sql（三张表 + 幂等唯一键）',
    '        docs/（SOP 三件套 + 提示词包 + 30 条验收清单 + 成本/Fallback 表）',
    '        docs/prompts/（按本项目变量渲染好的 P0–P8）',
    '',
    '第 1 步（现在做）：',
    '  cd ' + result.dir,
    '  pnpm install',
    '  pnpm dev        → 打开 http://localhost:3000，输入一句话点生成，看到 mock 结果即通过',
    '',
    '第 2 步：调 shovel_prompt { promptId: "kickoff" } 取「开工三件套」整段发给 AI Coding 工具；',
    '        它跑完后用 shovel_verify 体检，确认 core/ 没被改。',
  ]
  return lines.join('\n')
}

async function toolPrompt(args) {
  const payload = isRecord(args) ? args : {}
  const state = await loadState()
  const project = requireProject(state, payload.projectId)
  const result = await actionPromptGet({ ...payload, projectId: project.id })
  return `# ${result.title}\n\n（项目：${project.name} · ${project.dir}）\n\n${result.text}`
}

async function toolTask(args) {
  const payload = isRecord(args) ? args : {}
  const state = await loadState()
  const project = requireProject(state, payload.projectId)
  const stage = STAGES.find((item) => item.index === Number(project.stage)) || STAGES[0]
  if (payload.taskId === undefined) {
    const done = project.tasks || {}
    const lines = [`【${project.name}】第 ${stage.index} 步 · ${stage.title}`, stage.summary, '']
    for (const task of stage.tasks) lines.push(`[${done[task.id] === true ? 'x' : ' '}] ${task.id} · ${task.label}`)
    lines.push('', '勾选：shovel_task { taskId: "xxx", done: true }')
    return lines.join('\n')
  }
  const result = await actionTaskSet({ ...payload, projectId: project.id })
  const lines = [`已更新：${payload.taskId} → ${payload.done === true ? '完成' : '未完成'}`]
  lines.push(`当前进度：第 ${result.stage} 步`)
  for (const task of result.stageTasks) lines.push(`[${task.done ? 'x' : ' '}] ${task.id} · ${task.label}`)
  return lines.join('\n')
}

async function toolVerify(args) {
  const payload = isRecord(args) ? args : {}
  const state = await loadState()
  const project = requireProject(state, payload.projectId)
  const result = await verifyProject(project)
  project.lastVerify = { at: nowIso(), ok: result.ok, score: result.score, fail: result.counts.fail }
  project.updatedAt = nowIso()
  await saveState(state)
  const lines = [
    `【体检】${project.name} · 得分 ${result.score} · 通过 ${result.counts.pass} / 告警 ${result.counts.warn} / 不通过 ${result.counts.fail}`,
    '',
  ]
  for (const check of result.checks) {
    const mark = check.status === 'pass' ? '✓' : check.status === 'warn' ? '!' : check.status === 'skip' ? '-' : '✗'
    lines.push(`${mark} [${check.id}] ${check.title}：${check.detail}`)
    if (check.status === 'fail' || check.status === 'warn') {
      if (check.fix) lines.push(`    修法：${check.fix}`)
    }
  }
  lines.push('')
  lines.push(result.ok ? '结论：没有硬伤，可以继续下一步。' : '结论：先处理上面 ✗ 的项，别往下一步走。')
  return lines.join('\n')
}

async function toolAccept(args) {
  const payload = isRecord(args) ? args : {}
  const state = await loadState()
  const project = requireProject(state, payload.projectId)
  if (payload.results === undefined) {
    const view = acceptanceView(project)
    const groups = new Map()
    for (const item of view.items) {
      const list = groups.get(item.group) || []
      list.push(item)
      groups.set(item.group, list)
    }
    const lines = [`【30 条上线验收清单】${project.name}`, '']
    for (const [group, items] of groups) {
      lines.push(group)
      for (const item of items) {
        const mark = item.result === 'pass' ? '✓' : item.result === 'fail' ? '✗' : item.result === 'na' ? '-' : ' '
        lines.push(`  [${mark}] ${item.id} ${item.text}${item.hard ? '（硬门槛）' : ''}`)
      }
    }
    lines.push('', `已记录：通过 ${view.counts.pass} · 不通过 ${view.counts.fail} · 不适用 ${view.counts.na} · 未记录 ${view.counts.unset}`)
    lines.push('记录：shovel_accept { results: { A1: "pass", C2: "fail" } }')
    return lines.join('\n')
  }
  const view = await actionAccept({ ...payload, projectId: project.id })
  const verdictText = view.verdict === 'allowed'
    ? '允许上线 ✅'
    : view.verdict === 'incomplete'
      ? `还不能上线 ⏳（还有 ${view.counts.unset} 条没记录）`
      : '不允许上线 ❌'
  const lines = [
    `【验收结论】${verdictText}`,
    `通过 ${view.counts.pass} / 不通过 ${view.counts.fail} / 不适用 ${view.counts.na} / 未记录 ${view.counts.unset}`,
  ]
  if (view.hardFails.length > 0) lines.push(`硬门槛不通过：${view.hardFails.join('、')}（这些不修不许发链接）`)
  if (view.verdict === 'incomplete' && view.undecidedHard.length > 0) {
    lines.push(`还没记录的硬门槛：${view.undecidedHard.join('、')}（这些全是上线前必答题）`)
  }
  const failed = view.items.filter((item) => item.result === 'fail')
  if (failed.length > 0) {
    lines.push('', '不通过项（先修，再复验）：')
    for (const item of failed) lines.push(`  ✗ ${item.id} ${item.text}`)
  }
  if (view.counts.unset > 0) lines.push('', `还有 ${view.counts.unset} 条没记录，别急着对外发。`)
  return lines.join('\n')
}

async function toolEconomics(args) {
  const payload = isRecord(args) ? args : {}
  const state = await loadState()
  const project = findProject(state, payload.projectId)
  const result = await actionEconomics({ ...payload, projectId: project && project.id })
  const econ = result.economics
  const lines = [
    '【单位经济测算】',
    `售价 ${econ.input.priceYuan} 元/单 · 引擎 ${econ.input.enginePerCall} 元/次 × ${econ.input.callsPerTask} 次`,
    `存储带宽 ${econ.input.storagePerTask} 元 · 支付抽成 ${econ.input.paymentPct}%`,
    '',
    `单次成本 = ${econ.engineCost} + ${econ.input.storagePerTask} + ${econ.paymentCost} = ${econ.costPerTask} 元`,
    `单笔毛利 = ${econ.margin} 元（毛利率 ${econ.marginPct}%）`,
    `盈亏平衡获客成本 = ${econ.breakEvenCac} 元`,
    `按付费率 ${econ.input.payRatePct}% 算，每 1000 个访客期望毛利 = ${econ.thousandProfit} 元`,
    '',
    econ.ok ? '结论：算式成立（单次成本 × 调用量 ≤ 定价，获客成本也压得住）。' : '结论：现在不成立，先别放量。',
    '',
    ...econ.notes.map((note) => `· ${note}`),
  ]
  return lines.join('\n')
}

async function toolDoc(args) {
  const payload = isRecord(args) ? args : {}
  const result = await actionDocGet({ name: payload.name })
  const limit = 24000
  const text = result.text.length > limit ? `${result.text.slice(0, limit)}\n\n…（文档较长，已截断；完整内容在插件 assets/docs/${result.name}）` : result.text
  return `# ${result.name}\n\n${text}`
}

const TOOL_DEFS = [
  {
    name: 'shovel_status',
    description: '全栈铲子工作台总览：所有项目的阶段进度、本步任务、上次体检结果、验收状态。不确定该做什么时先调它。',
    parameters: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: '项目 id，省略则用当前活动项目' },
      },
      additionalProperties: false,
    },
    output: textOutput((value) => value),
    async execute(args) {
      return toolStatus(args)
    },
  },
  {
    name: 'shovel_new',
    description: '新建全栈项目骨架（复制 SPEC/冻结区契约/降级链/迁移 SQL/文档/提示词到目标目录，并记录基线哈希供体检比对）。也支持 adopt=true 纳管一个已有骨架目录。给 name 即可，其余可后补。',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '中文项目名，例如「小红书封面生成器」' },
        topic: { type: 'string', description: '英文短词，用作 apps/<topic> 与 URL；省略则自动生成' },
        dir: { type: 'string', description: '项目目录绝对路径；省略则落在默认根目录下' },
        oneLiner: { type: 'string', description: '一句话主题（P1 会用到）' },
        targetUser: { type: 'string', description: '目标用户' },
        interaction: { type: 'string', description: '主交互，例如「输入框→生成→右侧出图→可下载」' },
        primaryAdapter: { type: 'string', description: '主引擎名，默认 mock' },
        secondaryAdapter: { type: 'string', description: '备用引擎名，可空' },
        maxCost: { type: 'number', description: '单次调用成本上限（元），默认 0.5' },
        adopt: { type: 'boolean', description: 'true = 纳管已有目录，不复制骨架' },
      },
      required: ['name'],
      additionalProperties: false,
    },
    output: textOutput((value) => value),
    async execute(args) {
      return toolNew(args)
    },
  },
  {
    name: 'shovel_prompt',
    description: '取出可直接整段复制给 AI Coding 工具的提示词：kickoff（SPEC+P0+P1 开工三件套）/ spec / P0…P8。项目变量已填好，缺的字段会标「待填」。',
    parameters: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: '项目 id，省略用当前项目' },
        promptId: { type: 'string', enum: ['kickoff', 'spec', 'P0', 'P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8'], description: '要哪一条；默认 kickoff' },
      },
      additionalProperties: false,
    },
    output: textOutput((value) => value),
    async execute(args) {
      return toolPrompt(args)
    },
  },
  {
    name: 'shovel_task',
    description: '查看或勾选六步 SOP 的任务（taskId 见 shovel_status 的列表）。不传 taskId 就是查看本步清单。',
    parameters: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: '项目 id，省略用当前项目' },
        taskId: { type: 'string', description: '任务 id，例如 node / install / p2' },
        done: { type: 'boolean', description: 'true 勾选，false 取消' },
        stage: { type: 'number', description: '直接把进度设在第几步（0–6）' },
      },
      additionalProperties: false,
    },
    output: textOutput((value) => value),
    async execute(args) {
      return toolTask(args)
    },
  },
  {
    name: 'shovel_verify',
    description: '静态体检项目：关键文件、.env 填充度、NEXT_PUBLIC_ 是否混入服务端密钥、core/ 冻结区是否被改、降级链末尾是否还是 mock、仓库里有没有明文密钥、git 是否跟踪 .env.local、本机工具链。返回每项结论与修法。',
    parameters: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: '项目 id，省略用当前项目' },
      },
      additionalProperties: false,
    },
    output: textOutput((value) => value),
    async execute(args) {
      return toolVerify(args)
    },
  },
  {
    name: 'shovel_accept',
    description: '30 条上线验收清单：不传 results 时列出清单与已记录状态；传 results { A1:"pass", C2:"fail" } 记录并给出「是否允许上线」。hard 项（C1–C4、D1–D4、E1、B4、F1、H1、H2）不通过就不许上线。',
    parameters: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: '项目 id，省略用当前项目' },
        results: {
          type: 'object',
          description: '条目状态映射，值只能是 pass / fail / na',
          additionalProperties: { type: 'string' },
        },
        note: { type: 'string', description: '验收备注' },
      },
      additionalProperties: false,
    },
    output: textOutput((value) => value),
    async execute(args) {
      return toolAccept(args)
    },
  },
  {
    name: 'shovel_economics',
    description: '单位经济测算：售价/引擎单价/每次任务调用数/存储带宽/支付抽成/付费率/获客成本 → 单次成本、单笔毛利、盈亏平衡获客成本、每千访客期望毛利，并给结论。定价前必跑。',
    parameters: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: '项目 id，省略用当前项目' },
        priceYuan: { type: 'number', description: '每单售价（元）' },
        enginePerCall: { type: 'number', description: '引擎单次调用成本（元）' },
        callsPerTask: { type: 'number', description: '一次任务平均调用次数（含重试）' },
        storagePerTask: { type: 'number', description: '存储+带宽成本（元/单）' },
        paymentPct: { type: 'number', description: '支付通道抽成（百分比）' },
        payRatePct: { type: 'number', description: '付费转化率（百分比）' },
        cacYuan: { type: 'number', description: '获客成本（元/人）' },
      },
      additionalProperties: false,
    },
    output: textOutput((value) => value),
    async execute(args) {
      return toolEconomics(args)
    },
  },
  {
    name: 'shovel_doc',
    description: '读 SOP 原始文档：01_全栈开发SOP.md / 02_第一次跑通.md / 03_成本与避坑.md / SPEC.md / 目录结构.md / 上线验收清单.md / 新项目复用清单.md / 依赖安装清单.md / 提示词包-原文.md。要向用户解释或照着执行时先读原文，别凭记忆。',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '文档文件名，例如 02_第一次跑通.md' },
      },
      required: ['name'],
      additionalProperties: false,
    },
    output: textOutput((value) => value),
    async execute(args) {
      return toolDoc(args)
    },
  },
]

/* ------------------------------------------------------------------ 插件 -- */

function registerTools(ctx) {
  const dispose = []
  for (const definition of TOOL_DEFS) {
    try {
      const off = ctx.tools.register(definition)
      if (typeof off === 'function') dispose.push(off)
    } catch (error) {
      appendLog({ action: 'tool.register.failed', tool: definition.name, error: messageOf(error) })
    }
  }
  return () => {
    for (const off of dispose.reverse()) {
      try {
        off()
      } catch {
        /* 卸载失败不影响其他工具 */
      }
    }
  }
}

export function apply(ctx) {
  /* 工具：模型侧能力（人机协作的另一半是界面） */
  try {
    ctx.effect(() => registerTools(ctx), 'dsh-shovel: tools')
  } catch (error) {
    appendLog({ action: 'tools.mount.failed', error: messageOf(error) })
  }

  /* 主通道：Connection Fetch（桌面版与 Web 版都通） */
  ctx.effect(() => ctx.connection.fetch.register({
    path: ROUTE_API,
    methods: ['POST'],
    requestBody: 'buffered',
    async fetch(request) {
      let payload
      try {
        payload = await request.json()
      } catch {
        return jsonResponse(400, { ok: false, error: 'bad json' })
      }
      return handle(ctx, payload, 'api')
    },
  }))

  /* 兜底通道 + token（给脚本用；token 每次安装现生成） */
  const token = () => loadOrCreateToken()
  token().catch(() => {})

  const registerFallback = (scope) => {
    const server = scope.webServer
    scope.effect(() => server.register({
      kind: 'exact',
      path: ROUTE_TOKEN,
      handler: async (req, res) => {
        if (req.method !== 'GET') {
          res.writeHead(405, { 'content-type': 'application/json' })
          res.end('{"ok":false,"error":"method not allowed"}')
          return
        }
        try {
          res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
          res.end(JSON.stringify({ token: await token() }))
        } catch (error) {
          res.writeHead(500, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ ok: false, error: messageOf(error) }))
        }
      },
    }))
    scope.effect(() => server.register({
      kind: 'exact',
      path: ROUTE_FALLBACK,
      handler: async (req, res) => {
        if (req.method !== 'POST') {
          res.writeHead(405, { 'content-type': 'application/json' })
          res.end('{"ok":false,"error":"method not allowed"}')
          return
        }
        let expected
        try {
          expected = await token()
        } catch {
          res.writeHead(500, { 'content-type': 'application/json' })
          res.end('{"ok":false,"error":"token unavailable"}')
          return
        }
        if (req.headers['x-dsh-shovel-token'] !== expected) {
          res.writeHead(403, { 'content-type': 'application/json' })
          res.end('{"ok":false,"error":"forbidden"}')
          return
        }
        const chunks = []
        let total = 0
        const body = await new Promise((resolve, reject) => {
          req.on('data', (chunk) => {
            total += chunk.length
            if (total > 1 << 20) {
              reject(new Error('body too large'))
              req.destroy()
              return
            }
            chunks.push(chunk)
          })
          req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
          req.on('error', reject)
        }).catch(() => undefined)
        let payload
        try {
          payload = JSON.parse(body === undefined ? '' : body)
        } catch {
          res.writeHead(400, { 'content-type': 'application/json' })
          res.end('{"ok":false,"error":"bad json"}')
          return
        }
        const response = await handle(ctx, payload, 'web')
        res.writeHead(response.status, {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'no-store',
        })
        res.end(await response.text())
      },
    }))
  }

  try {
    if (typeof ctx.inject === 'function') {
      ctx.inject(['webServer'], registerFallback)
    } else if (ctx.get('webServer') !== undefined) {
      registerFallback(ctx)
    }
  } catch {
    /* 主通道足够 */
  }
}

async function handle(ctx, payload, source) {
  const started = Date.now()
  const action = payload && typeof payload.action === 'string' ? payload.action : ''
  try {
    const result = await dispatch(payload)
    await appendLog({ source, action, ms: Date.now() - started, ok: true })
    return jsonResponse(200, { ok: true, ...result })
  } catch (error) {
    const message = messageOf(error)
    await appendLog({ source, action, ms: Date.now() - started, ok: false, error: message })
    return jsonResponse(200, { ok: false, error: message })
  }
}

/* 供本机脚本/冒烟测试直接调用（不经过 HTTP） */
export const __internals = {
  ASSETS,
  SKELETON,
  stateDir,
  projectsRoot,
  loadState,
  saveState,
  createProject,
  verifyProject,
  acceptanceView,
  recordAcceptance,
  actionPromptGet,
  actionTaskSet,
  actionEconomics,
  actionAccept,
  actionVerify,
  actionState,
  dispatch,
  STAGES,
  CHECKLIST,
  PROMPTS,
  computeEconomics,
}
