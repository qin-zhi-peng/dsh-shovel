# 全栈开发 SOP · 技术方案（核心）

> 这套 SOP 综合了业界公开的全栈开发与上线实践经验（九层选型 + 上线流程），并针对 2026 年的 AI Coding 工作方式做了落地适配。
> 本方案做了两处**面向小白与 2026 年的适配**：① 代码由 AI Coding 工具按固定规格生成，你不写语法，只固定骨架与验收；② 把「换引擎」显式做成适配器 + 降级链，避免「引擎一改版产品就停摆」这种死法。

---

## 0. 这套 SOP 的全貌

```
                    ┌─────────────────────────────────────────┐
                    │  ① 固定骨架 core/（永远不动，只升级版本） │
  新项目 ──复制──▶  │  登录 / 数据库 / 点数 / 支付 / 存储      │
                    │  埋点 / 错误 / Fallback / UI 基础 / SEO  │
                    └──────────────────┬──────────────────────┘
                                       │ 只换下面两处
                    ┌──────────────────┴──────────────────────┐
                    │ ② 主题层 apps/<本次主题>/：页面 + 文案 + UI │
                    │ ③ 引擎层 adapters/<某个能力>/：接哪个 AI    │
                    └─────────────────────────────────────────┘
                                       ↓
              六步上线 SOP：环境 → 复制 → 生成 → 接通 → 部署 → 验收/复用
```

**为什么这样拆**：很多能快速起量的 AI 产品「共用同一副骨架，差别只在后面接的引擎与前面的 UI 主题」。把这句话变成目录约定，你就得到了可复制性；再加上适配器约定，你就得到了最缺的「抗平台风险」能力。

---

## 1. 九层选型表（钉死，不许每次重选）

左两列是常见做法；右侧是给小白的落地版。

| # | 层 | 常见做法 | 小白起步（建议钉死） | 大白话：这层干嘛 | 免费起步 | 何时升级 / 坑 |
|---|---|---|---|---|---|---|
| 1 | 开发基础 | TypeScript / React / **Next.js** | Next.js（App Router）+ TypeScript + Tailwind | 一个框架同时写「网页」和「后端接口」，不用单独搭服务器 | 免费（开源） | 别用 Pages Router 老写法；Node ≥ 20 |
| 2 | 登录注册 | Next-auth / Clerk | **Clerk**（最省事）；想全自控用 Auth.js | 用户能注册登录，才谈得上记点数、记订单 | 有免费额度 | 回调 URL 必须在服务商后台配齐（本地 + 线上各一套） |
| 3 | 数据存储 | Supabase / Neon | **Supabase**（Postgres + 自带表格后台） | 存用户、订单、点数、生成记录；有可视化后台能直接看数据 | 有免费额度 | 免费额度有休眠/限流，上线前看当期政策 |
| 4 | 多语言 | i18n / next-intl | next-intl（**出海才做，先留接口**） | 一份代码出中英文案 | 免费 | 第一版别做，会拖慢；但要预留 `messages/` 目录 |
| 5 | 支付 | Stripe / Lemon Squeezy / Creem | **Lemon Squeezy 或 Creem**（MoR 模式，个人主体更友好）→ 有海外主体再上 Stripe | 收钱、管订阅、发点数 | 通常无月费、按成交抽成 | ⚠️ Webhook 必须做**幂等**，否则重复加点数；收款主体/税务自行核实 |
| 6 | 文件存储 | S3 / R2 | **Cloudflare R2** | 存用户上传的图、AI 生成的结果文件 | 有免费额度 | 不要直接把文件塞数据库；外链要设过期时间 |
| 7 | 部署 | Vercel / Cloudflare | **Vercel 起步**（Next.js 一键）→ 流量起来迁 Cloudflare | 把代码变成一个能访问的网址 | Hobby 免费档 | 有站点迁到 Cloudflare 后每月省下数万元；注意免费档商用限制 |
| 8 | 域名 | GoDaddy / Namecheap | Namecheap / Cloudflare Registrar | 买网址 | 年费几十元 | ⚠️ **绝不抢注他人品牌词**（有蹭品牌词的域名被平台停止解析）；别囤域名 |
| 9 | 加速 | 商业模板（各类 SaaS 脚手架）＋ UI 库 Shadcn / MagicUI / HeroUI | **shadcn/ui + Tailwind**（免费）；预算够再买商业模板 | 界面不用从零画，按钮表单直接拼 | 免费 | 商业模板能再省半天，但**先看懂它生成的目录**，否则出问题不会修 |

> **复利点**：这九层的账号（GitHub / Vercel / Supabase / Clerk / 支付 / R2 / 域名）**只注册一次**，之后每个项目复用。成熟团队能 1 小时上线，一半原因是这些账号、收款通道、模板早就在手上了。

---

## 2. 两层架构：哪些文件永远不动，哪些每次换

```
my-app/
├── .env.example                 ← 每次复制后填成 .env.local（不进 Git）
├── SPEC.md                      ← 骨架规格，给 AI 的第一句话
├── package.json                 ← 依赖钉死，不轻易加包
├── src/
│   ├── core/                    ★ 永远不动（只整体升版本）
│   │   ├── auth/                # 登录会话、当前用户
│   │   ├── db/                  # 数据库客户端 + 迁移 SQL
│   │   ├── credits/             # 点数扣减（事务）、订单
│   │   ├── billing/             # 支付回调 webhook（幂等）
│   │   ├── storage/             # 上传 / 签名 URL
│   │   ├── observability/       # 日志、埋点、错误上报
│   │   ├── fallback/            # 超时 / 重试 / 降级链 / 预算阀
│   │   ├── seo/                 # metadata、sitemap、结构化数据
│   │   └── ui/                  # shadcn 基础组件 + 全站主题变量
│   ├── adapters/                ★ 每次换：一个能力一个文件
│   │   ├── types.ts             # 统一接口（见 §3）
│   │   ├── openrouter.ts        # 文本/对话类
│   │   ├── replicate.ts         # 图像/音视频类
│   │   └── mock.ts              # 本地假引擎（不花钱就能跑通全流程）
│   ├── apps/                    ★ 每次换：本次产品的页面与接口
│   │   └── <topic>/
│   │       ├── page.tsx         # 落地页 + 主交互
│   │       └── route.ts         # 本次的业务 API
│   └── content/                 # pSEO 数据 / 文案 / messages 多语言
└── tests/                       # 验收用例（上线清单的可执行版）
```

**铁律**：`apps/` 和 `adapters/` 里不许直接 `import` 某个厂商的 SDK；必须通过 `core/` 或统一接口。这样换供应商时只改一个文件。

---

## 3. 引擎适配器（这份方案里最值钱的一段）

业界最惨的两个教训：有的音乐生成工具依赖 **非官方端点**与个人账号 session，引擎一改版产品停摆；有的「一句话生成网页」工具被模型内化后直接停更。行业由此把结论写成工程原则：**「生产级 Agent 必须对所有外部依赖做 Fallback。没有例外。」**

把这句话落成代码，就是下面这个统一接口 + 降级链：

```ts
// src/adapters/types.ts —— 所有 AI 能力都长一个样
export type GenInput  = { prompt: string; userId: string; options?: Record<string, unknown> };
export type GenResult = { kind: "text" | "image" | "audio" | "url"; data: string; meta?: Record<string, unknown> };

export interface EngineAdapter {
  name: string;
  estimateCost(input: GenInput): number;          // 元/次，用于预算阀
  generate(input: GenInput, signal: AbortSignal): Promise<GenResult>;
}
```

```ts
// src/core/fallback/chain.ts —— 调用任何外部能力都走这里（示意）
const CHAIN: EngineAdapter[] = [primaryAdapter, secondaryAdapter, mockAdapter]; // 最后必须有兜底

export async function runWithFallback(input: GenInput) {
  for (const adapter of CHAIN) {
    if (adapter.estimateCost(input) > MAX_COST_PER_CALL) continue;   // ① 成本阀
    try {
      return await withTimeout(adapter.generate(input), 15_000);      // ② 超时
    } catch (e) {
      log.warn(`${adapter.name} failed, fallback`, e);                // ③ 降级 + 留痕
    }
  }
  throw new Error("ALL_ENGINES_DOWN");                                 // ④ 明确失败，不假装成功
}
```

**四条必须写进 SPEC 的约束**（对应成本与性能教训）：

| 约束 | 为什么 | 依据 |
|---|---|---|
| 每次调用前算 `estimateCost`，超过阈值直接拒绝 | Token 是钱，别等账单出来才发现 | 有工具产品因 Token + 带宽成本变成负收入 |
| 15s 超时 + 至少一级降级 + `mock` 兜底 | 引擎不可用时要能给用户明确反馈，而不是白屏 | 公开案例与工程实践 |
| P95 首字/首图延迟写进验收标准 | 性能是需求不是优化项 | 有搜索产品单次 >5s，留存崩塌 |
| 扣点数用**数据库事务**，且以「生成成功」为界 | 失败不能扣钱，webhook 重放不能重复扣 | 经济层指标（收入 − 引擎成本） |

> `mockAdapter` 是小白的救命文件：不填任何 API key 也能把「登录→扣点→生成→展示→支付」整条链路跑通。先跑通骨架，再接真引擎。

---

## 4. 六步上线 SOP

业界常见的上线 7 步是「确定做什么 → 查名/域名 → 用成熟框架做出来 → 部署 → PH/社媒 → GA/Search Console → 迭代」。下面是**技术版**，每步都给命令、产出物和验收点。

| 步 | 做什么 | 命令 / 动作 | 产出物 | 验收点（不过就别往下走） |
|---|---|---|---|---|
| **0** 环境 | 一次性装好工具、注册九层账号 | 见 `02_第一次跑通.md` | 本地 Node + 7 个账号 | `node -v` ≥ 20；`pnpm -v` 有输出 |
| **1** 复制骨架 | 复制 starter，改名，填 env，跑通占位页 | `cp -r starter my-app && cd my-app && cp .env.example .env.local && pnpm i && pnpm dev` | 一个能打开的 `localhost:3000` | 页面正常、无 env 报错、`mock` 引擎能出结果 |
| **2** 只换主题+引擎 | 把 `SPEC.md` + P0 + P1 提示词发给 AI Coding 工具 | 见 `starter/prompts/` | 页面 + `route.ts` + 新 adapter | 只改了 `apps/` 和 `adapters/`，`core/` 未被改动 |
| **3** 接通四件套 | 按 P2~P5 逐条接：登录 → 数据库 → 点数/支付 → 真引擎 | 每条提示词跑完就本地验一次 | 可注册、可扣点、可收款（测试模式） | 支付 webhook 重放两次，点数只加一次 |
| **4** 部署上线 | 推 Git → Vercel 自动部署 → 绑域名 → 后台配回调 | `git push`；在服务商后台填线上回调 URL | 公网可访问的地址 | 线上登录回调、支付回调、环境变量三项全绿 |
| **5** 埋点与看板 | 接 GA / Search Console，落四层指标 | 见 `templates/成本测算表.csv`、`03_成本与避坑.md` | 获取/激活/留存/经济 四层数据 | 能算出「单次成本 × 调用量 ≤ 定价」 |
| **6** 验收与回写 | 过上线清单 → 把本次可复用代码回写 `starter/` | 见 `templates/上线验收清单.md` | SPEC 升一个小版本 | 下个项目复制时，步骤 3 至少少一条提示词 |

**Step 3 的最小数据表**（Postgres，够用就别加字段）：

```sql
-- 用户与点数（Clerk 的 user_id 作外部主键）
create table profiles (
  user_id text primary key,
  credits integer not null default 0,
  created_at timestamptz default now()
);

-- 订单 / 支付回调幂等：provider_event_id 唯一，重放直接跳过
create table orders (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  provider_event_id text unique not null,
  amount_cents integer not null,
  credits_added integer not null,
  created_at timestamptz default now()
);

-- 每次生成留痕：算成本、查故障、复盘都靠它
create table generations (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  adapter text not null,
  cost_yuan numeric(10,4) not null default 0,
  latency_ms integer not null,
  status text not null,             -- ok | failed | fallback
  created_at timestamptz default now()
);
```

**支付闭环一句话**：webhook 收到事件 → 用 `provider_event_id` 查 `orders` 做幂等 → 在一个数据库事务里「写订单 + 加点数」→ 返回 2xx。**先扣点还是先生成**：先冻结点数、生成成功后真正扣除、失败回滚；绝不「先扣再说」。

---

## 5. 环境变量与密钥管理

见 `starter/.env.example`（每项都注明去哪拿）。三条纪律：

1. `.env.local` 永远不进 Git（`.gitignore` 里必须有），公开仓库只提交 `.env.example`。
2. 本地 / 预览 / 生产 **三套 key 分开**，服务商后台的回调 URL 也要配三套；这是小白上线失败的第一大原因。
3. 服务端密钥（支付、数据库 service role、AI key）只能出现在 `route.ts` / server 代码里，**任何 `NEXT_PUBLIC_` 开头的变量都是公开的**，别把密钥放进去。

---

## 6. pSEO：最值得抄的一条工程 SOP

增长手段里，ProductHunt 打榜是脉冲、蹭热点有合规风险，只有 **pSEO（程序化 SEO）是可复利资产**：有目录站在热点爆发前就攒了几千个结构化页面，热度到来直接拿到关键词前列、全年上千万访问。关键不是 SEO 技巧，是「**在需求爆发前把资产铺好**」的时间差。

工程形态（P6 提示词会照这个生成）：

```
数据采集/清洗 → AI 结构化成统一 schema → 存 content/ → 服务端渲染批量建页
→ sitemap 定时更新 → 每页有唯一 title/description/结构化数据
```

**给小白的边界**：2026 年关键词拥挤、蹭品牌词域名会被 ban。只做你自己有的数据（目录、模板、案例、集成清单），不批量生成空壳页，不碰他人品牌词。

---

## 7. 部署、成本与三条硬规矩

| 动作 | 依据 | 落地做法 |
|---|---|---|
| 起步用免费档，流量起来再迁 | 有站点迁移后每月省下数万元 | 第一版 Vercel Hobby；带宽/函数费用异常时再看 Cloudflare |
| 每次调用记 `cost_yuan` 与 `latency_ms` | 付费率极低 + 成本致负收入的公开案例 | `generations` 表 + 成本测算表，定价前必算 |
| 静态资源走 CDN、结果文件设过期 | 同上 | R2 + 缓存头，别让源站反复吐大文件 |
| 外部依赖全部 Fallback | 工程实践共识 | `runWithFallback` + `mock` 兜底 |

> **成本优化是产品决策，不是运维事项**（一句行话）：在薄毛利的工具型产品里，它的重要性不亚于拉新。

---

## 8. 怎么让这副骨架产生复利

本质很直白：光有骨架不等于有铲子，**把骨架本身产品化之后，生产函数才开始产生复利**。对你来说不需要真去卖模板，但要养成同一个动作：

- 每个项目结束，问一句：**这次写的哪段代码，下个项目还能直接用？** 能就回写 `starter/`，SPEC 版本号 +0.1。
- 记录每个项目的「复制 → 首个可访问页面」耗时。健康曲线是：第 1 个 1 天 → 第 2 个 3 小时 → 第 3 个 1 小时以内。
- 不要换骨架。有人两年做了近 20 个项目、只跑出 2 个，其中一个恰恰是「把骨架拿去卖」；**换骨架 = 每次归零**。

---

## 9. 与常见上线 SOP 的对照（确认没学偏）

| 常见做法 | 本方案 | 说明 |
|---|---|---|
| 确定做什么（抓新词/热词、致敬爆款） | 保留「选题」，但**去掉抢热点/蹭词** | 行业经验：2026 年不学「月更一个产品」「蹭品牌词」 |
| 确定名称，查商标与域名 | 保留，且强制查商标 | 蹭品牌词域名被停解析的教训 |
| 用成熟框架把产品做出来 | **升级为「复制固定骨架 + AI 按 SPEC 生成」** | 2026 年 AI Coding 已能写完全部代码，角色是项目经理+架构师+测试 |
| 部署上线 | 加：灰度、埋点、回滚、回调 URL 三套配置 | 补上「测试资源极度缺乏」这个短板 |
| PH / 社媒推广 | 只作可选脉冲，主推 pSEO 资产前置 | 流量 ≠ 生意 |
| GA / Search Console 数据分析 | 扩成四层指标 + 单位经济测算 | 四层指标 |
| 收集反馈持续迭代 | 加：回写 starter / SPEC 升版本 | 把「迭代」从单产品扩到骨架本身 |

---

*本方案中的服务名、免费额度、API 形态为选型参考，以各服务官方当期文档为准；文中的流量与收入数字仅用于说明量级，未经审计。*
