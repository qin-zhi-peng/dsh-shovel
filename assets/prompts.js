/**
 * 提示词包（P0–P8）：把 SOP 里那张「固定规格 + 固定指令」变成可填空的模板。
 *
 * 每个模板是一个函数：接收项目变量，返回一段可以直接整段贴给 AI Coding 工具的文本。
 * 变量渲染规则见 index.js 的 renderPrompt()：`【x】` 一类占位由项目字段填好，
 * 未填的保持原样并标注「待填」，避免小白漏填仍发给 AI。
 */

const S = (s) => String(s === undefined || s === null ? '' : s).trim()

/** 值或占位符：空字段不静默吞掉，而是留下可检索的待填标记。 */
const or = (value, tag) => (S(value) === '' ? `〔待填：${tag}〕` : S(value))

const FROZEN_RULES = `1. src/core/ 是冻结区，未经我单独确认禁止修改；新代码只能落在 src/apps/<topic>/、src/adapters/、src/content/、tests/。
2. 所有 AI 能力必须实现 src/adapters/types.ts 的统一接口，并走 src/core/fallback/run-with-fallback.ts；降级链末尾必须有 mockAdapter。禁止在页面或业务代码里直接 import 厂商 SDK。
3. 外部调用必须有超时、成本阀、失败留痕；失败不扣点数、不假装成功。
4. 支付 webhook 必须用 raw body 验签，用 orders.provider_event_id 做幂等；点数扣减在数据库事务里完成。
5. 服务端密钥不得出现在 NEXT_PUBLIC_ 变量里；.env.local 不进 Git。`

export const PROMPTS = [
  {
    id: 'P0',
    stage: 2,
    title: '总指令（每个项目第一条，只发一次）',
    summary: '复述五条铁律 + 固定四段交付格式，把 AI 的行为钉死',
    body: (v) => `你是本项目的全栈工程师。我负责描述需求和验收，不写代码。

我已给你《SPEC.md》，它是最高优先级约束，与本条指令冲突时以 SPEC 为准。请先复述以下 5 条，确认你已理解：
${FROZEN_RULES}

工作方式：一次只做我这一条指令要求的事，不顺手重构、不顺手加功能、不擅自新增依赖。
每次完成后，输出固定四段：【改动文件清单】【如何验收（可操作的命令或步骤）】【有没有触碰 core/】【有没有引入新依赖】。
不确定第三方 SDK 的具体 API 时，明说「以官方当期文档为准」并给可替换的封装，不要编造用法。

本次项目：${or(v.name, '产品名')}（apps/${or(v.topic, 'topic')}）。`,
  },

  {
    id: 'P1',
    stage: 2,
    title: '生成新项目（只换主题 + 引擎，先跑 mock）',
    summary: '落地页 + 业务接口 + mock 适配器，零 key 跑通全链路',
    body: (v) => `按 SPEC 生成本次产品。只改 src/apps/${or(v.topic, 'topic')}/ 与 src/adapters/，core/ 不许动。

【主题】：${or(v.oneLiner, '一句话主题')}
【目标用户】：${or(v.targetUser, '目标用户')}
【主交互】：${or(v.interaction, '主交互')}
【产品名 / 目录名】：${or(v.name, '产品名')} / ${or(v.topic, 'topic')}
【本次引擎】：先用 mockAdapter（不填任何 API key），真引擎留到 P5 再接

要求：
- 一个落地页 page.tsx：首屏说清价值 + 主输入框 + 生成按钮 + 结果区 + 明确的加载/失败/空状态。
- 一个业务接口 route.ts，流程严格为：鉴权占位 → zod 校验入参 → estimateCost 成本阀 → runWithFallback 生成 → 成功后扣点 → 写 generations 留痕。
- 补齐 adapters/mock.ts：返回结构合法的假结果，保证零 key 也能跑通全链路（骨架里已有最小实现，按本次主题改假数据即可）。
- 全站走 core/ui 的组件与主题变量，不要在业务页里写死颜色/间距。

验收：pnpm dev 打开首页 → 输入 → 点生成 → 看到 mock 结果 → 点数 -1 → 刷新后 generations 表能看到该行。
不要做：登录、真实支付、真实 AI 调用、批量 SEO 页面、后台管理。`,
  },

  {
    id: 'P2',
    stage: 3,
    title: '接通登录（Clerk）',
    summary: '登录/退出 + 业务接口 401 守卫 + 两套回调地址',
    body: () => `按 SPEC 的 core/auth 约定接通登录，仍然只改 apps/ 与必要的配置，core/ 不动。

要求：
- 用 @clerk/nextjs 做注册/登录/退出，登录态守卫覆盖 P1 的业务接口。
- 未登录访问 /api/<topic>/generate 返回 401，且前端给出「先登录」的明确引导。
- .env.example 补齐所需变量，并注明哪些是 NEXT_PUBLIC_、哪些是服务端专用。
- 本地与线上各一套回调地址，写进 README 的「上线配置清单」。

验收：未登录调用生成接口得到 401；登录后可正常生成；退出后再次 401。
不要做：自定义用户表字段、社交登录之外的第三方鉴权、改 core/auth 实现。`,
  },

  {
    id: 'P3',
    stage: 3,
    title: '接通数据库（Supabase 三张表 + 事务）',
    summary: '建表 SQL、冻结→扣点→回滚、按天成本汇总',
    body: () => `按 SPEC §4 建最小数据表并接通 core/db，迁移 SQL 放 supabase/migrations/（骨架里已给 0001_init.sql，按需补字段）。

表：profiles(user_id, credits)、orders(id, user_id, provider_event_id unique, amount_cents, credits_added)、
generations(id, user_id, adapter, cost_yuan, latency_ms, status)。

要求：
- 所有写操作通过 core/db 暴露的客户端；页面/业务代码里不写裸 SQL、不直接 import Supabase SDK。
- 点数扣减实现「冻结 → 生成成功才扣 → 失败回滚」，全程数据库事务。
- 给 profiles 加 RLS 或等价的服务端保护；service_role key 只在服务端使用。
- 写一个最小查询：按天汇总 调用次数 / 总成本 / 失败与降级次数，用于成本看板。

验收：Supabase 后台能看到三张表的新行；把生成流程强制失败一次，确认点数不变、generations 记录 status=failed。
不要做：加新表、加缓存层、改 core/db 的接口签名。`,
  },

  {
    id: 'P4',
    stage: 3,
    title: '接通支付与点数（幂等 webhook）',
    summary: 'raw body 验签 + provider_event_id 唯一 + 同事务加点',
    body: () => `按 SPEC §4 接通支付回调，实现「付款 → 加点数」的最小闭环。

要求：
- webhook 固定路径 /api/billing/webhook，用 raw body 验签（不要先被 JSON 中间件解析）。
- 用 orders.provider_event_id 唯一约束做幂等：同一事件重放两次，只写一条订单、只加一次点数。
- 「写订单 + 加点数」必须在同一个数据库事务里完成。
- 只用测试模式/沙箱金额；README 写明后台需要配置的 Webhook URL 与所需环境变量。
- 失败返回非 2xx 并留日志，不要静默吞掉。

验收：把同一条测试 webhook 连续重放两次，profiles.credits 只增加一次；orders 表只有一行；
      故意用错误签名请求，返回 4xx 且点数不变。
不要做：订阅升级/降级、优惠券、多币种、发票、改 core/billing 的接口。`,
  },

  {
    id: 'P5',
    stage: 3,
    title: '接真引擎 + Fallback 链',
    summary: '一个引擎一个文件，[primary, secondary, mock]，超时/成本阀/留痕',
    body: (v) => `按 SPEC §3 把 mock 换成真实引擎，并组装降级链。

【主引擎】：${or(v.primaryAdapter && v.primaryAdapter !== 'mock' ? v.primaryAdapter : '', '主引擎（如 openrouter）')}
【备用引擎】：${or(v.secondaryAdapter, '备用引擎；没有就留空，末尾仍然挂 mock')}
【单次成本上限】：MAX_COST_PER_CALL=${or(v.maxCost, '0.50')}（读 .env.local）

要求：
- 每个引擎一个 adapters/<name>.ts，实现 EngineAdapter：name / estimateCost / generate(input, signal)。
- adapters/index.ts 组装链：[primary, secondary, mock]，调用一律走 core/fallback/run-with-fallback.ts。
- 超时（AbortSignal）、每级最多重试 1 次、失败记 status=fallback 并写 generations。
- 调用前 estimateCost 超阈值直接拒绝；全链路失败抛 ALL_ENGINES_DOWN，给用户明确提示。
- 结果文件走 core/storage 的签名 URL，带过期时间。
- 任何情况下：失败不扣点、不白屏、不无限转圈。

验收：① 正常 key 出真实结果；② 把主引擎 key 改错 → 自动走备用或 mock，页面有明确提示且点数不变；
      ③ 模拟 20s 挂起 → 超时后降级；④ generations 表能查到 adapter / cost_yuan / latency_ms / status。
不要做：在页面里直接 fetch 厂商 API、把厂商 SDK import 到 core/、删掉 mock.ts。`,
  },

  {
    id: 'P6',
    stage: 3,
    title: 'pSEO 批量建页（可选）',
    summary: '自有数据 → 统一 schema → 服务端渲染 → sitemap',
    body: (v) => `按 SPEC 的 core/seo 约定，为本项目加一个可复用的 pSEO 模块。

【数据来源】：${or(v.seoSource, '你自己拥有的数据，例如工具目录 / 模板清单 / 案例库')}
【页面类型】：<例如 /tools/[slug]、/templates/[slug]>
【规模】：第一版先 30 页，验证收录后再扩

要求：
- 采集/清洗脚本 → 统一 schema（title / description / body / 结构化数据字段）→ 存 src/content/。
- 动态路由服务端渲染，每页唯一 title/description/canonical，带 JSON-LD 结构化数据。
- sitemap 自动生成并支持定时重建；有更新机制，不是一次性静态页。
- 页面必须有真实内容与内链，不许只用模板拼空壳。
- 不生成任何含他人品牌词的页面或域名。

验收：pnpm build 通过；/sitemap.xml 包含全部页面；随机抽 3 页，title/description 各不相同且内容非空。
不要做：买外链、批量注册域名、自动生成无实质内容的页面。`,
  },

  {
    id: 'P7',
    stage: 4,
    title: '部署与环境变量核对',
    summary: '三套 key、回调 URL 清单、本地四命令全绿、git push',
    body: (v) => `按 SPEC §7 帮我把项目准备好上线，只做配置与检查，不改业务逻辑。

要求：
- 逐条核对 .env.example 与 .env.local / Vercel Environment Variables（Production 与 Preview 分开），列出「缺失 / 疑似放错到 NEXT_PUBLIC_」的项。
- README 生成「上线配置清单」：需要去哪些后台填哪些回调 URL（Clerk、支付 Webhook、Supabase、域名），本地/线上各一套。
- 确认 .gitignore 包含 .env.local / node_modules / .next；确认仓库里没有任何密钥。
- 本地依次跑 pnpm typecheck && pnpm lint && pnpm test && pnpm build，把失败项逐个修掉。
- 给出 git init / remote / push 的命令，以及 Vercel 导入后的 Redeploy 步骤（项目目录：${or(v.dir, '项目目录')}）。

验收：四条命令全绿；README 的上线配置清单能照着一条条勾完；线上首页可访问。
不要做：改业务逻辑、新增依赖、顺手「优化」core/。`,
  },

  {
    id: 'P8',
    stage: 6,
    title: '上线前验收（刹车片，别省）',
    summary: '对 30 条清单逐条给通过/不通过/不适用 + 证据，先别动手修',
    body: () => `按《上线验收清单》（docs/上线验收清单.md）逐条检查本项目，输出一张结果表：通过 / 不通过 / 不适用 + 证据。

重点自行验证并给出结论：
1. 支付 webhook 重放两次，点数只加一次；错误签名被拒绝。
2. 主引擎 key 失效时自动降级，失败不扣点、页面有明确提示。
3. 未登录访问业务接口返回 401。
4. generations 表能查到 adapter / cost_yuan / latency_ms / status；能算出「单次成本 × 调用量 ≤ 定价」。
5. 首字/首图与 P95 延迟达到验收阈值。
6. 仓库里没有密钥；线上环境变量齐全；保留可回滚的上一个版本。
7. 所有新增/改动逻辑在 tests/ 有对应用例，pnpm typecheck && pnpm lint && pnpm test && pnpm build 全绿。

对每条「不通过」，给出最小修复方案，但先不要动手修，等我确认。
最后回答一句：这次写的哪段代码，下个项目能直接复用？如果可以，说明应该回写到 starter/ 的哪个模块，并建议 SPEC 版本号如何递增。`,
  },
]

/** 开工三件套：SPEC 全文 + P0 + P1，一次性贴给 AI 的第一个大包。 */
export function kickoff(spec, vars) {
  const p0 = PROMPTS.find((p) => p.id === 'P0')
  const p1 = PROMPTS.find((p) => p.id === 'P1')
  return [
    '# 第一部分：SPEC.md（硬约束，最高优先级）',
    '',
    spec,
    '',
    '# 第二部分：P0 总指令',
    '',
    p0.body(vars),
    '',
    '# 第三部分：P1 生成新项目',
    '',
    p1.body(vars),
  ].join('\n')
}

/** 给界面的目录用。 */
export function promptIndex() {
  return PROMPTS.map(({ id, stage, title, summary }) => ({ id, stage, title, summary }))
}
