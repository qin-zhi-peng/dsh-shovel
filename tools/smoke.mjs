// 冒烟测试：不依赖 DSH 宿主，直接调用 index.js 暴露的 __internals。
// 用法：node tools/smoke.mjs
import os from 'node:os'
import path from 'node:path'
import { promises as fsp } from 'node:fs'

const TMP = path.join(os.tmpdir(), 'dsh-shovel-smoke')
process.env.DSH_HOME = path.join(TMP, 'home')
process.env.DSH_SHOVEL_PROJECTS = path.join(TMP, 'projects')

const { __internals: S } = await import('../index.js')

let failures = 0
function check(name, condition, detail) {
  const ok = condition === true
  if (!ok) failures += 1
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail === undefined ? '' : ` — ${detail}`}`)
}

async function exists(target) {
  try {
    await fsp.stat(target)
    return true
  } catch {
    return false
  }
}

// 干净起点
await fsp.rm(TMP, { recursive: true, force: true })

const created = await S.createProject({
  name: '测试封面生成器',
  topic: 'cover-gen',
  oneLiner: '把一段文字转成一张配图',
  targetUser: '做小红书的个人创作者',
  interaction: '输入框 → 点生成 → 右侧出图 → 可下载',
  maxCost: 0.3,
})
const dir = created.dir
check('创建项目：返回 dir', typeof dir === 'string' && dir.length > 0, dir)

// 体检用台账里的完整记录（含 baseline），不是摘要
const fullProject = async () => {
  const state = await S.loadState()
  return state.projects.find((project) => project.id === created.project.id)
}
const baselineSize = Object.keys((await fullProject()).baseline).length
check('基线哈希已记录', baselineSize >= 3, `${baselineSize} 个冻结文件`)

const mustExist = [
  'SPEC.md',
  '.env.example',
  '.env.local',
  '.gitignore',
  'README.md',
  'package.json',
  'tsconfig.json',
  'src/adapters/types.ts',
  'src/adapters/mock.ts',
  'src/adapters/index.ts',
  'src/core/fallback/run-with-fallback.ts',
  'src/app/page.tsx',
  'src/app/api/mock-generate/route.ts',
  'supabase/migrations/0001_init.sql',
  'tests/skeleton.test.mjs',
  'docs/01_全栈开发SOP.md',
  'docs/02_第一次跑通.md',
  'docs/03_成本与避坑.md',
  'docs/上线验收清单.md',
  'docs/新项目复用清单.md',
  'docs/成本测算表.csv',
  'docs/依赖与Fallback表.csv',
  'docs/本项目信息.md',
  'docs/prompts/P0 · 总指令（每个项目第一条，只发一次）.md',
]
for (const relative of mustExist) {
  check(`脚手架文件存在：${relative}`, await exists(path.join(dir, relative)))
}

const env = await fsp.readFile(path.join(dir, '.env.local'), 'utf8')
check('.env.local 填了项目名', env.includes('NEXT_PUBLIC_APP_NAME=cover-gen'))
check('.env.local 填了成本上限', env.includes('MAX_COST_PER_CALL=0.3'))

// 体检：刚生成的骨架应当没有 fail
let verify = await S.verifyProject(await fullProject())
check('体检：无 fail', verify.counts.fail === 0, JSON.stringify(verify.counts))
check('体检：冻结区 pass', verify.checks.find((c) => c.id === 'frozen').status === 'pass')
check('体检：降级链 pass', verify.checks.find((c) => c.id === 'chain').status === 'pass')
check('体检：密钥扫描 pass', verify.checks.find((c) => c.id === 'secrets').status === 'pass')

// 故意改冻结区 → 必须被发现
const coreFile = path.join(dir, 'src/adapters/types.ts')
const original = await fsp.readFile(coreFile, 'utf8')
await fsp.writeFile(coreFile, original.replace('estimateCost', 'estimateCostPatched'), 'utf8')
verify = await S.verifyProject(await fullProject())
const frozen = verify.checks.find((c) => c.id === 'frozen')
check('体检：改 core/ 被抓到', frozen.status === 'fail' && frozen.detail.includes('types.ts'), frozen.detail)
await fsp.writeFile(coreFile, original, 'utf8')
verify = await S.verifyProject(await fullProject())
check('体检：恢复后重新 pass', verify.checks.find((c) => c.id === 'frozen').status === 'pass')

// 故意把服务端密钥塞进 NEXT_PUBLIC_ → 必须被发现
const envFile = path.join(dir, '.env.local')
const envOriginal = await fsp.readFile(envFile, 'utf8')
await fsp.writeFile(envFile, `${envOriginal}\nNEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiJ9.abc.def\n`, 'utf8')
verify = await S.verifyProject(await fullProject())
const publicSecret = verify.checks.find((c) => c.id === 'public-secret')
check('体检：NEXT_PUBLIC_ 混入服务端密钥被抓到', publicSecret.status === 'fail', publicSecret.detail)
await fsp.writeFile(envFile, envOriginal, 'utf8')

// 提示词渲染
const kickoff = await S.actionPromptGet({ promptId: 'kickoff' })
check('提示词 kickoff 含 SPEC 头', kickoff.text.includes('第一部分：SPEC.md'))
check('提示词 kickoff 填了项目名', kickoff.text.includes('测试封面生成器'))
check('提示词 kickoff 含 P1 主题', kickoff.text.includes('把一段文字转成一张配图'))
const p5 = await S.actionPromptGet({ promptId: 'P5' })
check('提示词 P5 填了成本上限', p5.text.includes('0.3'))
const p0 = await S.actionPromptGet({ promptId: 'P0' })
check('提示词 P0 含五条铁律', p0.text.includes('src/core/ 是冻结区'))

// 任务勾选与阶段推进
let task = await S.actionTaskSet({ taskId: 'install', done: true })
check('任务勾选：install', task.stageTasks.find((t) => t.id === 'install').done === true)
for (const id of ['dev', 'mock']) await S.actionTaskSet({ taskId: id, done: true })
const stageState = await S.loadState()
check('阶段自动推进到 2', stageState.projects[0].stage === 2, String(stageState.projects[0].stage))
check('任务已完成 scaffold', stageState.projects[0].tasks.scaffold === true)

// 单位经济
const econ = await S.actionEconomics({ projectId: created.project.id, priceYuan: 1, enginePerCall: 0.02, callsPerTask: 1.3, storagePerTask: 0.01, paymentPct: 5, payRatePct: 1, cacYuan: 0 })
check('算账：单次成本 0.086', Math.abs(econ.economics.costPerTask - 0.086) < 1e-9, String(econ.economics.costPerTask))
check('算账：毛利 0.914', Math.abs(econ.economics.margin - 0.914) < 1e-9, String(econ.economics.margin))
check('算账：结论成立', econ.economics.ok === true)
const badEcon = await S.actionEconomics({ projectId: created.project.id, priceYuan: 0.01 })
check('算账：卖一单亏一单时结论不成立', badEcon.economics.ok === false)

// 验收：没记完 → 不算通过；硬门槛不通过 → 不允许上线
let partial = await S.actionAccept({ projectId: created.project.id, results: { A1: 'pass' } })
check('验收：只记 1 条 → 未完成，不允许上线', partial.verdict === 'incomplete' && partial.allowed === false, partial.verdict)
check('验收：未完成的硬门槛被点名', partial.undecidedHard.includes('C2'))
let accept = await S.actionAccept({ projectId: created.project.id, results: { C2: 'fail', A1: 'pass' } })
check('验收：C2 不通过 → 不允许上线', accept.allowed === false)
check('验收：硬门槛清单包含 C2', accept.hardFails.includes('C2'))
const all = {}
for (const item of S.CHECKLIST) all[item.id] = 'pass'
accept = await S.actionAccept({ projectId: created.project.id, results: all })
check('验收：30 条全过 → 允许上线', accept.allowed === true, JSON.stringify(accept.counts))
check('验收：通过数 30', accept.counts.pass === 30)

// 文档读取
const doc = await S.dispatch({ action: 'doc.get', name: '02_第一次跑通.md' })
check('文档读取：02_第一次跑通', doc.text.includes('报错速查'))

// 状态聚合
const state = await S.actionState()
check('状态：项目已入台账', state.projects.length === 1)
check('状态：默认项目根目录', typeof state.projectsRoot === 'string' && state.projectsRoot.length > 0, state.projectsRoot)
check('状态：提示词索引 9 条', state.prompts.length === 9, String(state.prompts.length))

// 收尾
await fsp.rm(TMP, { recursive: true, force: true })

console.log('')
console.log(failures === 0 ? 'ALL SMOKE TESTS PASSED' : `${failures} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
