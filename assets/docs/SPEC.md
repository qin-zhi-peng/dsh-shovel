# 骨架规格 SPEC（给 AI 的第一句话 · 不得违反）

> **用法**：每次开新项目，把本文件全文粘给 AI Coding 工具作为最高优先级约束，再发 `prompts/复用提示词包.md` 的 P0 总指令。
> **版本**：v1.0（每完成一个项目、把可复用代码回写本骨架后，版本号 +0.1）
> **目标**：让「同一副骨架 × 不同引擎」在开发层面真正成立——任何新项目只改 `apps/` 与 `adapters/`，`core/` 永远不动。

---

## 0. 角色与铁律

你是这个项目的全栈工程师。我（使用者）不写代码，只负责描述需求与验收。你必须：

1. **先读本 SPEC，再动手**；任何与本文件冲突的做法，以本文件为准。
2. **一次只做一条提示词要求的事**，做完给出「改了哪些文件 + 如何验收」，不要顺手重构、不要顺手加功能。
3. **`src/core/` 下的文件默认禁止修改**。确需修改必须先说明理由并单独确认；能靠扩展解决的绝不改核心。
4. 每完成一步，明确列出**验收命令/操作**，让我能当场验证。
5. 不确定第三方 API 形态时，先说明「此处以官方当期文档为准」，给出可替换的封装，**不要编造 SDK 用法**。

---

## 1. 技术栈（钉死，不许重新选型）

| 层 | 选型 |
|---|---|
| 框架 | Next.js（App Router）+ TypeScript + Tailwind CSS |
| UI | shadcn/ui 基础组件 + 全站 CSS 变量主题 |
| 登录 | Clerk（`@clerk/nextjs`）；未登录访问业务接口返回 401 |
| 数据库 | Supabase（Postgres）；只用 `src/core/db/` 暴露的客户端 |
| 支付/点数 | MoR 类服务（Lemon Squeezy / Creem）或 Stripe；webhook 必须幂等 |
| 文件存储 | Cloudflare R2；只用签名 URL，不暴露公开写权限 |
| AI 引擎 | 一律通过 `src/adapters/` 统一接口，禁止在页面/业务代码里直接 import 厂商 SDK |
| 部署 | Vercel（起步）；环境变量三套：local / preview / production |
| 校验 | 所有外部输入用 zod 校验 |
| 观测 | 日志 + 埋点 + 错误上报，统一走 `src/core/observability/` |

**加新依赖前必须先问我**。依赖越少，骨架越稳。

---

## 2. 目录约定

```
src/
├── core/           ★ 冻结区：auth / db / credits / billing / storage /
│                     observability / fallback / seo / ui
├── adapters/       ★ 可换区：types.ts（统一接口）+ 每个引擎一个文件 + mock.ts
├── apps/<topic>/   ★ 可换区：page.tsx（页面）+ route.ts（本次业务 API）
└── content/        pSEO 数据、文案、messages（多语言预留）
```

- 本次产品的所有新代码，只能落在 `src/apps/<topic>/`、`src/adapters/`、`src/content/`、`tests/`。
- `core/` 通过明确的导出被引用；**禁止反向依赖**（core 不得 import apps/adapters 的具体实现）。
- 文件命名：小写中划线；一个 adapter 一个文件；一个业务 API 一个 route。

---

## 3. 引擎适配器（最高优先级设计约束）

所有 AI 能力必须实现统一接口（`src/adapters/types.ts`）：

```ts
export type GenInput  = { prompt: string; userId: string; options?: Record<string, unknown> };
export type GenResult = { kind: "text" | "image" | "audio" | "url"; data: string; meta?: Record<string, unknown> };

export interface EngineAdapter {
  name: string;
  estimateCost(input: GenInput): number;                       // 元/次
  generate(input: GenInput, signal: AbortSignal): Promise<GenResult>;
}
```

调用一律走 `src/core/fallback/runWithFallback()`，链上必须满足：

- 至少两级真引擎 + **末尾 `mockAdapter` 兜底**（不填任何 key 也能跑通全流程）。
- 调用前 `estimateCost()` 超 `MAX_COST_PER_CALL` 直接拒绝。
- 15s 超时（AbortSignal）；失败记 `status = fallback` 并留日志。
- 任一级失败自动降级；全部失败抛 `ALL_ENGINES_DOWN`，**不许假装成功**。
- **失败不扣点数**，用户看到明确提示，不白屏、不无限转圈。

> 背景：有音乐工具依赖非官方端点、有建站工具被模型能力内化，两个项目都因此死掉。工程实践由此把「生产级 Agent 必须对所有外部依赖做 Fallback，没有例外」写成架构原则。这条不是可选项。

---

## 4. 必须存在的最小模块（core/ 清单）

| 模块 | 要求 |
|---|---|
| `auth/` | 当前用户、登录态守卫；服务端接口强制鉴权 |
| `db/` | 单一客户端；迁移 SQL 放 `supabase/migrations/`；禁止在页面里写裸 SQL |
| `credits/` | **冻结 → 成功才扣 → 失败回滚**，全程数据库事务 |
| `billing/` | webhook 验签用 **raw body**；`orders.provider_event_id` 唯一做幂等；事务内「写订单 + 加点数」 |
| `storage/` | 上传/下载走签名 URL，带过期时间 |
| `observability/` | 每次生成写 `adapter / cost_yuan / latency_ms / status`；错误可追溯 |
| `fallback/` | 超时、重试、降级链、成本阀 |
| `seo/` | metadata、sitemap、结构化数据；页面服务端渲染 |
| `ui/` | 基础组件 + 主题变量；不在业务页里写死颜色/间距 |

数据表最小集（够用就别加字段）：`profiles(user_id, credits)`、`orders(id, user_id, provider_event_id unique, amount_cents, credits_added)`、`generations(id, user_id, adapter, cost_yuan, latency_ms, status)`。建表 SQL 见 `01_全栈开发SOP.md` §4。

---

## 5. 非功能要求（写进验收，不当「优化项」）

- **性能**：首字/首图响应与 P95 延迟有明确阈值（默认 P95 < 3s，按场景调整并写进验收清单）。
- **成本**：能查到「昨日总引擎成本 / 单次成本」；定价前完成单位经济测算。
- **安全**：服务端密钥绝不出现在 `NEXT_PUBLIC_` 变量里；`.env.local` 不进 Git；所有输入 zod 校验。
- **可回滚**：保留上一个可部署版本；任何改动可单独 revert。
- **可观测**：失败必须留痕，不许静默 catch 后继续。
- **i18n**：预留 `src/content/messages/`，但第一版不强求多语言。

---

## 6. 明确禁止

1. 抢注/蹭他人品牌词域名、批量生成空壳 SEO 页、宣称与实际能力不符的功能。
2. 在 `apps/` 或页面组件里直接 import 任何 AI / 支付 / 数据库厂商 SDK。
3. 把非官方端点、个人账号 session 当作生产依赖。
4. 无幂等的支付回调、无事务的点数扣减、无超时的外部调用。
5. 提交 `.env.local`、密钥、用户数据到仓库。
6. 为「更快」而改动 `core/`；为「好看」而引入新依赖。

---

## 7. 完成定义（Definition of Done）

一条提示词算做完，必须同时满足：

- [ ] 改动文件清单已列出，且 `core/` 未被改动（或已单独确认）
- [ ] 本地 `pnpm dev` 可跑通，给出了可操作的验收步骤
- [ ] `mockAdapter` 链路仍然可用（不依赖任何外部 key）
- [ ] `pnpm build` 通过
- [ ] 新增/改动逻辑在 `tests/` 有对应用例
- [ ] 未引入未经批准的新依赖

> 对应一条最痛的经验：「AI 做得很快，但是我没有足够的时间去验收，也不知道功能完不完整、有没有 bug。」**没有验收标准的实现，不算完成。**

---

*第三方 SDK 的具体 API 形态以各服务官方当期文档为准；本 SPEC 只固定架构约束与边界。*
