# 全栈铲子 · dsh-shovel

**把「同一副骨架 × 不同引擎」的全栈开发 SOP，变成一套能点、能查、能复用的工作台。**

人和 AI 共用同一份台账：你在界面上点，AI 在工具里调，改的是同一个项目状态。
配套一副**真能跑起来**的 Next.js 骨架（零 API key 也能跑通全链路），六步从新建项目走到上线验收。

> A DeepSeek Harness (DSH) plugin that turns a reusable full-stack SOP into an executable
> workbench: scaffold a project, track the six launch steps, render P0–P8 prompts, audit the
> frozen core and leaked secrets, record a 30-item launch checklist, and compute unit economics.
> **English TL;DR at the bottom.**

---

## 为什么会有这个

全栈 SOP 的问题从来不是内容不好，而是**执行全靠人记**：九层选型、六步上线、30 条验收、
「`core/` 不许改」、「webhook 必须幂等」——每次开新项目都要重新翻文档、靠自觉。

这个插件把 SOP 落成四个可执行的动作：

| 原本 | 现在 |
|---|---|
| 手动复制 starter、手改 8 处 | **新建项目**一键生成整套骨架（SPEC、冻结区契约、降级链、迁移 SQL、全部文档、渲染好的提示词） |
| 翻文档找「这一步该干什么」 | **六步进度台账**，标出本步任务，勾完自动前进 |
| 复制提示词、手填占位符 | **P0–P8 按项目变量渲染**，一键复制；缺的字段标「待填」 |
| 靠自觉守铁律 | **体检脚本直接查**：`core/` 有没有被改、`NEXT_PUBLIC_` 有没有混进服务端密钥、降级链末尾还是不是 mock、仓库里有没有明文密钥 |

## 装了什么

### 1）左侧栏「⛏ 全栈铲子」工作台

六个页签，人和 AI 看的是同一份状态：

- **工作台**：项目切换、阶段进度、本步任务勾选、下一步卡片（复制命令 / 复制提示词）
- **提示词**：开工三件套（SPEC + P0 + P1）、P0–P8 全文预览与一键复制
- **体检**：12 组静态检查，每项给结论 + 修法
- **验收**：30 条上线验收清单三态勾选（未记录 → 通过 → 不通过 → 不适用），硬门槛不通过直接判「不允许上线」
- **算账**：单位经济测算（单次成本、单笔毛利、盈亏平衡获客成本、每千访客期望毛利）
- **手册**：SOP 原文 + SPEC + 目录约定 + 验收清单，随时查

### 2）给 AI 的 8 个工具（`shovel_*`）

| 工具 | 作用 |
|---|---|
| `shovel_status` | 总览：项目、阶段进度、本步任务、上次体检、验收状态 |
| `shovel_new` | 新建项目（生成可跑的 Next 骨架 + 全部文档） |
| `shovel_prompt` | 取 P0–P8 提示词（按项目变量渲染，可直接整段复制） |
| `shovel_task` | 查看 / 勾选六步任务，自动推进阶段 |
| `shovel_verify` | 静态体检：冻结区、密钥、降级链、env 填充度、git 跟踪 |
| `shovel_accept` | 30 条上线验收的查询与记录，给出「是否允许上线」 |
| `shovel_economics` | 单位经济测算，算出盈亏平衡获客成本 |
| `shovel_doc` | 读 SOP 原始文档 |

工具和界面走**同一批 Host 动作**，所以不会出现「界面说完成了、工具看不到」。

### 3）可独立使用的骨架

`assets/skeleton/` 就是一副能跑的 Next.js App Router 骨架：

- 统一引擎适配器 + 降级链（末尾永远挂 `mock`，零 key 可跑）
- mock 生成页 + `/api/mock-generate`（zod 校验，空输入 400）
- Supabase 迁移 SQL（profiles / orders / generations）
- 6 条骨架自检用例（`node --test tests/*.test.mjs`）

不装 DSH 也能用：

```bash
cp -r assets/skeleton my-app && cd my-app
pnpm install
pnpm dev            # http://localhost:3000，先看 mock 链路
pnpm typecheck      # 0
pnpm build          # Next 15 静态页
```

已验证：`pnpm install` → `pnpm typecheck`（0）→ `pnpm build`（0，Next 15.5.29）→ 起服务后
`POST /api/mock-generate` 返回 `adapter=mock status=ok`，空输入返回 400。

## 安装（DSH 插件）

要求：DSH 桌面版 / 网页版，Node ≥ 20，pnpm（`corepack enable` 即可）。

```bash
# 1. 克隆到任意目录（下面以 D:/plugins/dsh-shovel 为例）
git clone https://github.com/qin-zhi-peng/dsh-shovel.git D:/plugins/dsh-shovel
```

```jsonc
// 2. 编辑 profile 的 package.json（Windows: %USERPROFILE%\.dsh\profiles\desktop\package.json）
//    web 版把 desktop 换成 web。加两处：
{
  "dependencies": {
    "dsh-shovel": "link:D:/plugins/dsh-shovel"
  },
  "dsh": {
    "profile": {
      "bundles": [
        // ……原有的 bundle 保持不动，末尾加这一项
        "dsh-shovel"
      ]
    }
  }
}
```

```bash
# 3. 在 profile 目录装链接 + 重启 DSH
cd %USERPROFILE%/.dsh/profiles/desktop
pnpm install
```

重启后，左侧栏底部出现「⛏ 全栈铲子」，同时 8 个 `shovel_*` 工具进入模型工具表。
插件自带的 `cordis.patch.yml` 负责把宿主条目插进插件树，不需要额外配置。

> 只想用骨架、不想装插件：直接复制 `assets/skeleton/`，见上一节。

## 一次真实用法

```
我：新建一个「小红书封面生成器」项目
AI：（shovel_new）→ 生成骨架，告诉你第 1 步跑 pnpm install / pnpm dev
我：跑通了
AI：（shovel_task 勾掉 dev/mock）→ 进度到第 2 步，把开工三件套给你
我：贴给 Cursor / Claude Code，它改完 apps/ 与 adapters/
AI：（shovel_verify）→ 抓出「core/ 被改了 1 个文件，让它回滚」
...
AI：（shovel_accept）→ C2 幂等没过 → 不允许上线
```

## 六步进度

| 步 | 阶段 | 本步做什么 |
|---|---|---|
| 1 | 环境 + 骨架 | 装工具、新建项目、`pnpm dev` 看到 mock 链路 |
| 2 | 生成主题 | 把 SPEC + P0 + P1 发给 AI，只改 `apps/` 与 `adapters/` |
| 3 | 接通四件套 | 按 P2–P5 接登录 → 数据库 → 点数/支付 → 真引擎 |
| 4 | 部署 | 推 Git → 部署平台 → 绑域名 → 配回调 |
| 5 | 埋点与看板 | 四层指标（获取 / 激活 / 留存 / 经济）+ 成本测算 |
| 6 | 验收与回写 | 过 30 条清单 → 把可复用代码回写骨架，SPEC 升版本 |

## 仓库结构

```
dsh-shovel/
├── index.js              # Host 半：状态、脚手架、体检、验收、算账、8 个工具、HTTP 通道
├── client.js             # Client 半：侧栏入口 + 六页工作台
├── cordis.patch.yml      # 插件挂载条目
├── assets/
│   ├── prompts.js        # P0–P8 提示词模板
│   ├── workflow.js       # 六阶段/任务、30 条清单、env 分级、密钥特征、经济公式
│   ├── skeleton/         # 可跑的 Next 15 骨架（适配器契约 + 降级链 + mock + 迁移 SQL）
│   ├── docs/             # SOP 原文（01/02/03）、SPEC、模板、提示词包
│   └── templates/        # env.example、成本测算表、依赖与 Fallback 表
├── locale/{zh,en}.json   # 界面文案
├── tools/smoke.mjs       # 冒烟测试（不依赖 DSH 宿主）
└── .github/workflows/    # CI：语法检查 + 冒烟测试
```

## 本地自检

```bash
node --check index.js && node --check client.js
node tools/smoke.mjs
```

冒烟测试覆盖：建项目 → 文件齐全 → 体检无 fail → 改 `core/` 被抓 → `NEXT_PUBLIC_` 塞服务端密钥被抓 →
提示词渲染 → 任务勾选自动进阶段 → 单位经济 → 验收三态 → 文档读取 → 状态聚合。全部通过才 `exit 0`。

## 边界（说清楚，别误用）

- 插件**不替 AI 写业务代码**：它负责规格、骨架、提示词、进度与验收；代码仍由 AI Coding 工具按 SPEC 生成。
- 体检是**静态检查**，不等于跑通：`pnpm build`、支付重放、真实降级这些仍要人跑一遍（30 条清单就是干这个的）。
- 骨架默认只装 `next / react / react-dom / zod`（都没有 build script，装起来干净）；Clerk、Supabase 这类到 P2/P3 再加。
  **pnpm 12 起 `package.json` 的 `pnpm` 字段不再生效**：新依赖带 build script 时 `pnpm install` 会以
  `ERR_PNPM_IGNORED_BUILDS` 退出（包其实已装好），跑 `pnpm approve-builds` 放行即可。
- 主要在本机 Windows 上验证；CI 在 Ubuntu / Windows 双平台跑冒烟测试。
- 界面**视觉**未由作者做过截图级验收：面板已注册且 active，实际观感请以你打开的样子为准。

## 数据与隐私

- 台账存在 `~/.dsh/shovel/state.json`，操作日志 `~/.dsh/shovel/ops.log`，全部在本机。
- 新建的项目默认落在 `~/.dsh/shovel/projects/<目录名>`，可用环境变量 `DSH_SHOVEL_PROJECTS` 覆盖。
- 插件不联网、不上传任何项目内容；密钥扫描只做本地文本匹配。

## 文档的来路与脱敏

`assets/docs/` 里的 SOP 是一份**工程实践整理**：九层选型、六步上线、降级链、验收清单这些骨架来自业界公开的
独立开发实践与通用工程常识，本文档做了面向 2026 年 AI Coding 工作方式的改写与整理。
**仓库里不包含任何第三方报告的原文**；文中出现的产品、数字均为公开技术案例的抽象表述，不指向任何具体个人或团队。
如果你发现仍有可识别的第三方信息，请开 issue，会立刻处理。

## License

[MIT](LICENSE) © 2026 秦志鹏

---

## English TL;DR

**dsh-shovel** is a [DeepSeek Harness](https://github.com/deepseek-ai) plugin that turns a reusable
full-stack SOP into an executable workbench.

- **Scaffold**: one click → a runnable Next.js 15 skeleton (SPEC, frozen `core/` contract, adapter +
  fallback chain ending in `mock`, Supabase migration, 30-item launch checklist, P0–P8 prompts).
- **Track**: six launch stages with auto-advancing checklists, shared by human UI and agent tools.
- **Audit**: static checks for frozen-file drift, server secrets leaking into `NEXT_PUBLIC_`,
  fallback chain ending in `mock`, tracked `.env.local`, and plaintext keys.
- **Decide**: 30-item launch checklist with hard gates, plus unit-economics math
  (cost per task, margin, break-even CAC).

Eight agent tools (`shovel_status/new/prompt/task/verify/accept/economics/doc`) share one ledger with
the six-page UI. The skeleton under `assets/skeleton/` can be used standalone without DSH:

```bash
cp -r assets/skeleton my-app && cd my-app && pnpm install && pnpm dev
```

Install as a DSH plugin: clone, add `"dsh-shovel": "link:<path>"` to a profile's `dependencies`,
append `"dsh-shovel"` to `dsh.profile.bundles`, run `pnpm install` in that profile, restart DSH.

MIT licensed. No telemetry, no network calls; state stays in `~/.dsh/shovel/`.
