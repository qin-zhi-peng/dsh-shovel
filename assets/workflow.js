/**
 * 六步上线 SOP 的数据化版本：阶段、任务、30 条验收清单、环境变量分级、经济测算公式。
 * 界面和 Host 工具读的是同一份，避免「文档写一套、工具跑另一套」。
 */

/** 六步上线（0 环境 → 6 验收回写），每步的勾选项就是「人机协作」的最小单元。 */
export const STAGES = [
  {
    index: 0,
    id: 'env',
    title: '0 环境',
    summary: '一次性装好工具、注册账号，以后所有项目复用',
    tasks: [
      { id: 'node', label: 'Node ≥ 20、pnpm、git 可用（本机可让 DSH 帮你装）' },
      { id: 'accounts', label: '九层账号已注册：GitHub / Vercel / Supabase / Clerk / 支付 / AI 引擎 / R2 / 域名' },
      { id: 'env', label: '.env.local 已按 .env.example 填好（AI key 可以先空着，走 mock）' },
    ],
  },
  {
    index: 1,
    id: 'skeleton',
    title: '1 复制骨架',
    summary: '拿到能跑起来的骨架，先零 key 跑通 mock 链路',
    tasks: [
      { id: 'scaffold', label: '项目骨架已生成（本插件“新建项目”一键完成）' },
      { id: 'install', label: 'pnpm install 成功' },
      { id: 'dev', label: 'pnpm dev 打开 localhost:3000 无报错' },
      { id: 'mock', label: 'mock 链路跑通：输入 → 生成 → 展示 → 点数 -1' },
    ],
  },
  {
    index: 2,
    id: 'theme-engine',
    title: '2 只换主题+引擎',
    summary: '把 SPEC + P0 + P1 发给 AI，只改 apps/ 与 adapters/',
    tasks: [
      { id: 'kickoff', label: '开工三件套（SPEC + P0 + P1）已发给 AI Coding 工具' },
      { id: 'p1', label: 'P1 跑完：落地页 + route.ts + mock 适配器就位' },
      { id: 'core-intact', label: 'core/ 一个文件都没被改（体检项会自动比对）' },
      { id: 'verify-mock', label: 'AI 给的验收步骤当场跑过一遍' },
    ],
  },
  {
    index: 3,
    id: 'four',
    title: '3 接通四件套',
    summary: '登录 → 数据库 → 支付点数 → 真引擎，一次一条，验完再下一条',
    tasks: [
      { id: 'p2', label: 'P2 登录：未登录调接口 401，登录后可生成' },
      { id: 'p3', label: 'P3 数据库：三张表可见，强制失败不扣点' },
      { id: 'p4', label: 'P4 支付：同一条 webhook 重放两次，点数只加一次' },
      { id: 'p5', label: 'P5 引擎：主 key 改错仍能降级，失败不扣点' },
    ],
  },
  {
    index: 4,
    id: 'deploy',
    title: '4 部署上线',
    summary: '本地 build 先过，再推 Git → Vercel → 绑域名 → 配回调',
    tasks: [
      { id: 'build', label: '本地 pnpm build 通过（能把 80% 部署失败提前拦下）' },
      { id: 'push', label: '代码已推到自己的仓库（remote 指向本项目）' },
      { id: 'envs', label: 'Vercel 环境变量 Production / Preview 分开填齐' },
      { id: 'callbacks', label: 'Clerk / 支付 / Supabase / 域名 四处回调地址换成线上' },
      { id: 'smoke', label: '线上首页把第 1 步的四件事再走一遍' },
    ],
  },
  {
    index: 5,
    id: 'metrics',
    title: '5 埋点与算账',
    summary: '接 GA / Search Console，把「单次成本 × 调用量 ≤ 定价」算出来',
    tasks: [
      { id: 'ga', label: 'GA / Search Console 已接，能看到访问来源' },
      { id: 'costboard', label: 'generations 表能查出每日调用次数 / 总成本 / 失败与降级次数' },
      { id: 'economics', label: '单位经济测算已填完（本插件“算账”页可算）' },
    ],
  },
  {
    index: 6,
    id: 'accept',
    title: '6 验收与回写',
    summary: '过 30 条清单 → 回写骨架 → SPEC 升 0.1 → 记耗时',
    tasks: [
      { id: 'verify', label: '本插件“体检”全绿（或已逐条处理告警）' },
      { id: 'checklist', label: '30 条上线验收清单已过，无「不通过」' },
      { id: 'writeback', label: '这次能复用的代码已回写 starter/，SPEC 版本 +0.1' },
      { id: 'timing', label: '「复制骨架 → 首个可访问页面」耗时已记录' },
    ],
  },
]

/** 30 条上线验收清单，按 A–H 分组；hard = 不通过就不许上线。 */
export const CHECKLIST = [
  { id: 'A1', group: 'A 功能与交互', text: '首屏一句话说清价值，主输入框 + 生成按钮 + 结果区齐备', hard: false },
  { id: 'A2', group: 'A 功能与交互', text: '加载中 / 成功 / 失败 / 空状态 / 无权限，五种状态都有明确反馈', hard: false },
  { id: 'A3', group: 'A 功能与交互', text: '所有外部输入经 zod 校验，超长、空值、特殊字符不会打崩接口', hard: false },
  { id: 'A4', group: 'A 功能与交互', text: '刷新页面后，生成记录仍在（数据库链路通）', hard: false },
  { id: 'A5', group: 'A 功能与交互', text: '结果可下载/复制，签名 URL 带过期时间', hard: false },

  { id: 'B1', group: 'B 鉴权', text: '注册 / 登录 / 退出全流程可用（本地 + 线上各验一遍）', hard: false },
  { id: 'B2', group: 'B 鉴权', text: '未登录访问业务接口返回 401，前端有「先登录」引导', hard: false },
  { id: 'B3', group: 'B 鉴权', text: 'Clerk 后台已配置本地与线上两套 Allowed Origins / 回调地址', hard: false },
  { id: 'B4', group: 'B 鉴权', text: 'service_role key 只在服务端使用，未出现在任何 NEXT_PUBLIC_ 变量', hard: true },

  { id: 'C1', group: 'C 支付与点数', text: 'webhook 用 raw body 验签，错误签名返回 4xx 且点数不变', hard: true },
  { id: 'C2', group: 'C 支付与点数', text: '同一条 webhook 重放两次，点数只加一次（provider_event_id 唯一）', hard: true },
  { id: 'C3', group: 'C 支付与点数', text: '「写订单 + 加点数」在同一个数据库事务里', hard: true },
  { id: 'C4', group: 'C 支付与点数', text: '点数流程是「冻结 → 生成成功才扣 → 失败回滚」，失败绝不扣点', hard: true },
  { id: 'C5', group: 'C 支付与点数', text: '全程测试模式/沙箱金额；线上回调 URL 与 env 中的密钥一致', hard: false },

  { id: 'D1', group: 'D 引擎与 Fallback', text: '所有 AI 调用走 runWithFallback()，页面/业务代码里无厂商 SDK 直连', hard: true },
  { id: 'D2', group: 'D 引擎与 Fallback', text: '降级链至少两级 + 末尾 mock；主引擎 key 改错仍能给出结果或明确提示', hard: true },
  { id: 'D3', group: 'D 引擎与 Fallback', text: '超时生效（模拟挂起请求验证），无白屏、无无限转圈', hard: true },
  { id: 'D4', group: 'D 引擎与 Fallback', text: '失败写 generations.status = fallback / failed 并留日志，无静默 catch', hard: true },
  { id: 'D5', group: 'D 引擎与 Fallback', text: '未使用任何非官方端点、个人账号 session', hard: false },

  { id: 'E1', group: 'E 成本与性能', text: 'estimateCost() 成本阀生效，超 MAX_COST_PER_CALL 直接拒绝', hard: true },
  { id: 'E2', group: 'E 成本与性能', text: '后台能查到「昨日总引擎成本 / 单次成本 / 调用次数」', hard: false },
  { id: 'E3', group: 'E 成本与性能', text: '完成单位经济测算：单次成本 × 调用量 ≤ 定价，结论写在 README', hard: false },
  { id: 'E4', group: 'E 成本与性能', text: '首字/首图与 P95 延迟达到验收阈值（默认 P95 < 3s）', hard: false },

  { id: 'F1', group: 'F 数据与隐私', text: '仓库无 .env.local、无密钥、无用户数据；.gitignore 齐全', hard: true },
  { id: 'F2', group: 'F 数据与隐私', text: 'profiles 有 RLS 或等价服务端保护，用户不能改他人点数', hard: false },
  { id: 'F3', group: 'F 数据与隐私', text: '用户数据、AI 生成内容标识、版权与目标市场合规要求已自行核实', hard: false },

  { id: 'G1', group: 'G SEO 与内容', text: '每页唯一 title / description / canonical，带结构化数据，sitemap.xml 可访问', hard: false },
  { id: 'G2', group: 'G SEO 与内容', text: '无空壳页、无他人品牌词、无抢注域名；宣称口径与实际能力一致', hard: false },

  { id: 'H1', group: 'H 部署与回滚', text: 'pnpm typecheck && pnpm lint && pnpm test && pnpm build 四条全绿', hard: true },
  { id: 'H2', group: 'H 部署与回滚', text: '保留上一个可部署版本，可一键回退；线上环境变量齐全', hard: true },
]

/**
 * 环境变量分级：.env.local 里哪些是「跑 mock 就必须有」，哪些是接通某层才需要。
 * secret=true 的键绝不允许出现在 NEXT_PUBLIC_ 里。
 */
export const ENV_LEVELS = [
  { key: 'NEXT_PUBLIC_APP_URL', level: 'base', label: '应用地址' },
  { key: 'NEXT_PUBLIC_APP_NAME', level: 'base', label: '应用名' },
  { key: 'SUPABASE_URL', level: 'db' },
  { key: 'SUPABASE_ANON_KEY', level: 'db', secret: true },
  { key: 'SUPABASE_SERVICE_ROLE_KEY', level: 'db', secret: true },
  { key: 'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY', level: 'auth' },
  { key: 'CLERK_SECRET_KEY', level: 'auth', secret: true },
  { key: 'BILLING_API_KEY', level: 'billing', secret: true },
  { key: 'BILLING_WEBHOOK_SECRET', level: 'billing', secret: true },
  { key: 'BILLING_PRODUCT_ID', level: 'billing' },
  { key: 'OPENROUTER_API_KEY', level: 'engine', secret: true },
  { key: 'REPLICATE_API_TOKEN', level: 'engine', secret: true },
  { key: 'FAL_API_KEY', level: 'engine', secret: true },
  { key: 'MAX_COST_PER_CALL', level: 'base' },
  { key: 'ENGINE_TIMEOUT_MS', level: 'base' },
  { key: 'R2_ACCOUNT_ID', level: 'storage', secret: true },
  { key: 'R2_ACCESS_KEY_ID', level: 'storage', secret: true },
  { key: 'R2_SECRET_ACCESS_KEY', level: 'storage', secret: true },
  { key: 'R2_BUCKET', level: 'storage' },
  { key: 'NEXT_PUBLIC_GA_ID', level: 'optional' },
]

/** 保密值特征：用来扫「仓库里有没有把真密钥提交上去」。 */
export const SECRET_PATTERNS = [
  { name: 'Clerk 密钥', re: /\bsk_(test|live)_[A-Za-z0-9]{10,}/ },
  { name: 'OpenAI / OpenRouter 密钥', re: /\bsk-(or-)?[A-Za-z0-9_-]{20,}/ },
  { name: 'Supabase service_role JWT', re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\./ },
  { name: 'Stripe / 支付密钥', re: /\b(sk|rk)_live_[A-Za-z0-9]{10,}/ },
  { name: '私钥文件内容', re: /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { name: 'GitHub token', re: /\bgh[pousr]_[A-Za-z0-9]{30,}/ },
]

/** 单位经济：定价前必须算清楚的那一张表。 */
export function computeEconomics(input = {}) {
  const num = (value, fallback) => {
    const n = Number(value)
    return Number.isFinite(n) && n >= 0 ? n : fallback
  }
  const priceYuan = num(input.priceYuan, 1)
  const enginePerCall = num(input.enginePerCall, 0.02)
  const callsPerTask = num(input.callsPerTask, 1.3)
  const storagePerTask = num(input.storagePerTask, 0.01)
  const paymentPct = num(input.paymentPct, 5)
  const payRatePct = num(input.payRatePct, 1)
  const cacYuan = num(input.cacYuan, 0)

  const engineCost = enginePerCall * callsPerTask
  const paymentCost = (priceYuan * paymentPct) / 100
  const costPerTask = engineCost + storagePerTask + paymentCost
  const margin = priceYuan - costPerTask
  const marginPct = priceYuan > 0 ? (margin / priceYuan) * 100 : 0
  const perVisitorValue = (payRatePct / 100) * margin
  const breakEvenCac = margin
  const thousandProfit = 1000 * perVisitorValue // 每 1000 个访客的期望毛利

  const notes = []
  if (margin <= 0) notes.push('售价低于单次成本：现在卖一单亏一单，先降引擎成本或提价。')
  if (margin > 0 && margin < 0.2) notes.push('毛利率低于 20%，薄毛利产品必须严控调用量与重试。')
  if (payRatePct < 1) notes.push('付费率低于 1%（见过低至 0.03% 的案例）：先别放量投放，先验证有人愿意付。')
  if (cacYuan > breakEvenCac) notes.push(`获客成本 ${cacYuan} 元已高于单笔毛利 ${margin.toFixed(3)} 元，投放会放大亏损。`)
  if (notes.length === 0) notes.push('这张表目前成立：单次成本 × 调用量 ≤ 定价，且毛利能覆盖获客成本。')

  return {
    input: { priceYuan, enginePerCall, callsPerTask, storagePerTask, paymentPct, payRatePct, cacYuan },
    engineCost: round(engineCost),
    paymentCost: round(paymentCost),
    costPerTask: round(costPerTask),
    margin: round(margin),
    marginPct: round(marginPct),
    perVisitorValue: round(perVisitorValue),
    breakEvenCac: round(breakEvenCac),
    thousandProfit: round(thousandProfit),
    ok: margin > 0 && cacYuan <= breakEvenCac,
    notes,
  }
}

function round(n) {
  return Math.round(n * 10000) / 10000
}
