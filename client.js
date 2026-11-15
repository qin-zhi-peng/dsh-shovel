/**
 * 全栈铲子 · 浏览器半。
 *
 * 左侧栏底部一个入口 + 一块覆盖全屏的工作台。工作台和 agent 用的是同一批 Host 动作
 * （POST /api/dsh-shovel），所以「人点界面」和「AI 调工具」看到的是同一份台账：
 *  - 工作台：六步 SOP 的进度、本步任务勾选、下一步该干什么
 *  - 提示词：P0–P8 按项目填好变量，一键复制，整段贴给 AI Coding 工具
 *  - 体检：core/ 有没有被改、密钥有没有泄漏、mock 是否还在链尾
 *  - 验收：30 条清单三态勾选 + 能否上线的结论
 *  - 算账：单次成本 × 调用量 ≤ 定价
 *  - 手册：SOP 原文随时查
 */

window.__ModuleLoader__.load({
  id: 'dsh-shovel',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const BUILD = '2026-11-15a'
    const NS = 'dshShovel'
    const FOOTER_SLOT = 'sidebar.footer.action'
    const OVERLAY_SLOT = 'shell.overlay'
    /* 文档相对路径：Web 与桌面传输桥都能用，且不怕挂载前缀。 */
    const API_ROUTE = 'api/dsh-shovel'
    const FALLBACK_ROUTE = '/dsh-shovel/api'
    const TOKEN_ROUTE = '/dsh-shovel/token'

    const DICT = {
      en: {
        'action.open': 'Full-stack Shovel',
        'panel.title': 'Full-stack Shovel · Workbench',
        'tab.work': 'Workbench',
        'tab.prompts': 'Prompts',
        'tab.verify': 'Health',
        'tab.accept': 'Acceptance',
        'tab.econ': 'Unit economics',
        'tab.docs': 'Handbook',
        'action.close': 'Close',
        'action.new': '+ New project',
        'action.copy': 'Copy',
        'action.copied': 'Copied',
        'action.run': 'Run health check',
      },
      zh: {
        'action.open': '全栈铲子',
        'panel.title': '全栈铲子 · 工作台',
        'tab.work': '工作台',
        'tab.prompts': '提示词',
        'tab.verify': '体检',
        'tab.accept': '验收',
        'tab.econ': '算账',
        'tab.docs': '手册',
        'action.close': '关闭',
        'action.new': '＋ 新建项目',
        'action.copy': '复制',
        'action.copied': '已复制',
        'action.run': '运行体检',
      },
    }

    function format(template, vars) {
      let out = template
      for (const [key, value] of Object.entries(vars || {})) {
        out = out.split(`{${key}}`).join(String(value))
      }
      return out
    }

    /** 译文取值：优先宿主 locale，取不到就回落到内置中文。 */
    function trOf(t) {
      return (key, vars) => {
        try {
          if (typeof t === 'function') {
            const value = t(key, vars)
            if (typeof value === 'string' && value !== '' && value !== key) return value
          }
        } catch {
          /* 回落 */
        }
        const dict = DICT.zh
        return format(dict[key] !== undefined ? dict[key] : key, vars)
      }
    }

    /* ------------------------------------------------------------ 传输层 -- */

    async function readResult(response) {
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      return response.json()
    }

    async function postPrimary(body) {
      return readResult(await fetch(API_ROUTE, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }))
    }

    let tokenPromise
    function token() {
      tokenPromise ??= fetch(TOKEN_ROUTE, { credentials: 'same-origin' })
        .then((response) => (response.ok ? response.json() : Promise.reject(new Error(`token ${response.status}`))))
        .then((value) => String(value.token))
        .catch((error) => {
          tokenPromise = undefined
          throw error
        })
      return tokenPromise
    }

    async function postFallback(body) {
      const value = await token()
      return readResult(await fetch(FALLBACK_ROUTE, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json', 'x-dsh-shovel-token': value },
        body: JSON.stringify(body),
      }))
    }

    const transports = [
      { label: 'connection-fetch', post: postPrimary },
      { label: 'web-token', post: postFallback },
    ]
    let chosenTransport

    async function call(action, payload) {
      const body = { action, build: BUILD, ...payload }
      const attempts = chosenTransport === undefined ? transports : [chosenTransport]
      let lastError
      for (const candidate of attempts) {
        let data
        try {
          data = await candidate.post(body)
        } catch (error) {
          lastError = error
          continue
        }
        chosenTransport = candidate
        if (!data || data.ok !== true) throw new Error((data && data.error) || '操作失败')
        return data
      }
      throw lastError instanceof Error ? lastError : new Error(String(lastError))
    }

    /* ------------------------------------------------------------ 面板状态 -- */

    let panelOpen = false
    const listeners = new Set()
    function emit() {
      for (const listener of [...listeners]) listener()
    }
    function setOpen(next) {
      if (panelOpen === next) return
      panelOpen = next
      emit()
    }
    function usePanelOpen() {
      const [, force] = React.useReducer((value) => value + 1, 0)
      React.useEffect(() => {
        listeners.add(force)
        return () => listeners.delete(force)
      }, [])
      return panelOpen
    }

    async function copyText(text) {
      try {
        await navigator.clipboard.writeText(text)
        return true
      } catch {
        try {
          const box = document.createElement('textarea')
          box.value = text
          box.style.position = 'fixed'
          box.style.opacity = '0'
          document.body.appendChild(box)
          box.select()
          const ok = document.execCommand('copy')
          document.body.removeChild(box)
          return ok
        } catch {
          return false
        }
      }
    }

    /* ---------------------------------------------------------------- 样式 -- */

    const CSS = `
.dsh-shovel-foot{display:inline-flex;align-items:center;gap:6px;height:26px;padding:0 10px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.18));background:transparent;color:var(--dsw-alias-label-secondary,#9a9a9a);font:inherit;font-size:12px;line-height:16px;cursor:pointer;white-space:nowrap;}
.dsh-shovel-foot:hover{background:var(--dsw-alias-bg-layer-2,rgba(255,255,255,.08));color:var(--dsw-alias-label-primary,#e6e6e6);}
.dsh-shovel-foot.is-compact{padding:0 7px;}
.dsh-shovel-scrim{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.45);}
.dsh-shovel-panel{display:flex;flex-direction:column;width:min(940px,calc(100vw - 56px));height:min(760px,86vh);box-sizing:border-box;border-radius:14px;overflow:hidden;background:var(--dsw-alias-bg-layer-1,#1d1d1f);color:var(--dsw-alias-label-primary,#e6e6e6);border:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.14));box-shadow:0 24px 64px rgba(0,0,0,.5);}
.dsh-shovel-head{display:flex;align-items:center;gap:10px;padding:14px 18px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.1));}
.dsh-shovel-title{font-size:15px;font-weight:600;line-height:22px;flex:none;}
.dsh-shovel-head-actions{margin-left:auto;display:flex;align-items:center;gap:8px;flex-wrap:wrap;justify-content:flex-end;}
.dsh-shovel-tabs{display:flex;gap:4px;padding:8px 14px 0;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.1));flex-wrap:wrap;}
.dsh-shovel-tab{padding:6px 12px;border:0;border-radius:8px 8px 0 0;background:transparent;color:var(--dsw-alias-label-secondary,#9a9a9a);font:inherit;font-size:12.5px;cursor:pointer;}
.dsh-shovel-tab:hover{background:var(--dsw-alias-bg-layer-2,rgba(255,255,255,.06));color:var(--dsw-alias-label-primary,#e6e6e6);}
.dsh-shovel-tab.is-active{background:var(--dsw-alias-bg-layer-2,rgba(255,255,255,.1));color:var(--dsw-alias-label-primary,#e6e6e6);font-weight:600;}
.dsh-shovel-body{flex:1;min-height:0;overflow:auto;padding:16px 18px 22px;display:flex;flex-direction:column;gap:12px;}
.dsh-shovel-btn{display:inline-flex;align-items:center;gap:6px;padding:5px 11px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.2));background:transparent;color:var(--dsw-alias-label-primary,#e6e6e6);font:inherit;font-size:12px;line-height:17px;cursor:pointer;}
.dsh-shovel-btn:hover{background:var(--dsw-alias-bg-layer-2,rgba(255,255,255,.08));}
.dsh-shovel-btn:disabled{opacity:.55;cursor:default;}
.dsh-shovel-btn.is-primary{border-color:var(--dsw-alias-brand-primary,#c9a15b);color:var(--dsw-alias-brand-primary,#c9a15b);}
.dsh-shovel-btn.is-danger{color:var(--dsw-alias-state-error-primary,#ff5d5d);border-color:var(--dsw-alias-state-error-primary,#ff5d5d);}
.dsh-shovel-btn.is-small{padding:2px 8px;font-size:11.5px;line-height:16px;}
.dsh-shovel-select,.dsh-shovel-input{height:30px;box-sizing:border-box;padding:0 9px;border-radius:7px;border:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.14));background:var(--dsw-alias-bg-layer-2,rgba(255,255,255,.06));color:inherit;font:inherit;font-size:12.5px;}
.dsh-shovel-input{width:100%;}
.dsh-shovel-input:focus,.dsh-shovel-select:focus{outline:1px solid var(--dsw-alias-brand-primary,#c9a15b);}
.dsh-shovel-card{padding:12px 14px;border-radius:10px;border:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.12));background:var(--dsw-alias-bg-layer-2,rgba(255,255,255,.04));display:flex;flex-direction:column;gap:8px;}
.dsh-shovel-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap;}
.dsh-shovel-muted{color:var(--dsw-alias-label-secondary,#9a9a9a);font-size:12px;line-height:17px;}
.dsh-shovel-mono{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:11.5px;word-break:break-all;}
.dsh-shovel-stages{display:flex;gap:6px;flex-wrap:wrap;}
.dsh-shovel-stage{padding:4px 10px;border-radius:999px;border:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.14));background:transparent;color:var(--dsw-alias-label-secondary,#9a9a9a);font:inherit;font-size:11.5px;line-height:16px;cursor:pointer;white-space:nowrap;}
.dsh-shovel-stage.is-done{border-color:var(--dsw-alias-state-success-primary,#49c07a);color:var(--dsw-alias-state-success-primary,#49c07a);}
.dsh-shovel-stage.is-current{border-color:var(--dsw-alias-brand-primary,#c9a15b);color:var(--dsw-alias-brand-primary,#c9a15b);font-weight:600;}
.dsh-shovel-task{display:flex;align-items:flex-start;gap:8px;padding:5px 0;font-size:13px;line-height:19px;cursor:pointer;}
.dsh-shovel-task input{margin-top:2px;accent-color:var(--dsw-alias-brand-primary,#c9a15b);}
.dsh-shovel-task.is-done span{color:var(--dsw-alias-label-secondary,#9a9a9a);text-decoration:line-through;}
.dsh-shovel-list{display:flex;flex-direction:column;gap:6px;}
.dsh-shovel-item{display:flex;align-items:flex-start;gap:8px;padding:7px 9px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.1));font-size:12.5px;line-height:18px;}
.dsh-shovel-item.is-pass{border-color:var(--dsw-alias-state-success-primary,#49c07a);}
.dsh-shovel-item.is-warn{border-color:var(--dsw-alias-state-warn-primary,#e0b061);}
.dsh-shovel-item.is-fail{border-color:var(--dsw-alias-state-error-primary,#ff5d5d);}
.dsh-shovel-mark{flex:none;width:16px;text-align:center;font-weight:700;}
.dsh-shovel-mark.is-pass{color:var(--dsw-alias-state-success-primary,#49c07a);}
.dsh-shovel-mark.is-warn{color:var(--dsw-alias-state-warn-primary,#e0b061);}
.dsh-shovel-mark.is-fail{color:var(--dsw-alias-state-error-primary,#ff5d5d);}
.dsh-shovel-mark.is-skip{color:var(--dsw-alias-label-secondary,#9a9a9a);}
.dsh-shovel-two{display:grid;grid-template-columns:minmax(180px,240px) 1fr;gap:12px;min-height:260px;}
.dsh-shovel-menu{display:flex;flex-direction:column;gap:3px;overflow:auto;max-height:52vh;}
.dsh-shovel-menu-item{text-align:left;padding:6px 9px;border-radius:7px;border:0;background:transparent;color:var(--dsw-alias-label-secondary,#9a9a9a);font:inherit;font-size:12.5px;line-height:18px;cursor:pointer;}
.dsh-shovel-menu-item:hover{background:var(--dsw-alias-bg-layer-2,rgba(255,255,255,.06));color:var(--dsw-alias-label-primary,#e6e6e6);}
.dsh-shovel-menu-item.is-active{background:var(--dsw-alias-bg-layer-2,rgba(255,255,255,.1));color:var(--dsw-alias-label-primary,#e6e6e6);font-weight:600;}
.dsh-shovel-pre{flex:1;min-height:200px;max-height:50vh;overflow:auto;margin:0;padding:12px;border-radius:9px;border:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.12));background:var(--dsw-alias-bg-base,#111);font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:11.5px;line-height:18px;white-space:pre-wrap;word-break:break-word;}
.dsh-shovel-form{display:grid;grid-template-columns:110px 1fr;gap:8px 10px;align-items:center;}
.dsh-shovel-form label{font-size:12.5px;color:var(--dsw-alias-label-secondary,#9a9a9a);}
.dsh-shovel-econ{display:grid;grid-template-columns:170px 1fr;gap:7px 10px;align-items:center;font-size:12.5px;}
.dsh-shovel-banner{font-size:12.5px;line-height:18px;padding:8px 11px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.12));}
.dsh-shovel-banner.is-error{color:var(--dsw-alias-state-error-primary,#ff5d5d);border-color:var(--dsw-alias-state-error-primary,#ff5d5d);}
.dsh-shovel-banner.is-ok{color:var(--dsw-alias-state-success-primary,#49c07a);border-color:var(--dsw-alias-state-success-primary,#49c07a);}
.dsh-shovel-badge{flex:none;padding:0 6px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.2));font-size:10.5px;line-height:15px;color:var(--dsw-alias-label-secondary,#9a9a9a);}
`

    function Style() {
      return h('style', { key: 'dsh-shovel-style' }, CSS)
    }

    /* ------------------------------------------------------------ 通用组件 -- */

    function Btn({ children, onClick, primary, danger, small, disabled, title }) {
      const cls = ['dsh-shovel-btn']
      if (primary) cls.push('is-primary')
      if (danger) cls.push('is-danger')
      if (small) cls.push('is-small')
      return h('button', { type: 'button', className: cls.join(' '), onClick, disabled, title }, children)
    }

    const NEXT_BY_STAGE = {
      0: {
        title: '先把工具装好（约 15 分钟）',
        hint: 'node -v 要 ≥ 20；pnpm -v 有输出；git --version 有输出。',
        commands: ['node -v', 'corepack enable', 'corepack prepare pnpm@latest --activate', 'git --version'],
      },
      1: {
        title: '第 1 步：先把 mock 链路跑通（零 API key）',
        hint: '不用填任何 AI key。页面能打开、点生成有 mock 结果，就说明骨架是健康的。',
        commands: ['pnpm install', 'pnpm dev'],
      },
      2: {
        title: '第 2 步：把「开工三件套」发给 AI Coding 工具',
        hint: 'SPEC 全文 + P0 总指令 + P1 生成提示词，一次性贴给 AI。只让它改 apps/ 与 adapters/。',
        promptId: 'kickoff',
      },
      3: {
        title: '第 3 步：一次接通一件，每件当场验收',
        hint: 'P2 登录 → P3 数据库 → P4 支付幂等 → P5 真引擎 + Fallback。每条跑完先验再下一条。',
        prompts: ['P2', 'P3', 'P4', 'P5'],
      },
      4: {
        title: '第 4 步：部署上线',
        hint: '先本地 pnpm build 通过，再推 Git → Vercel → 绑域名 → 把四处回调地址换成线上。',
        prompts: ['P7'],
        commands: ['pnpm build', 'git add . && git commit -m "init"', 'git push -u origin main'],
      },
      5: {
        title: '第 5 步：埋点与算账',
        hint: '接 GA / Search Console；后台能查到昨日总成本与单次成本；到「算账」页把单位经济算成立。',
        prompts: ['P6'],
      },
      6: {
        title: '第 6 步：验收 + 回写骨架',
        hint: '过 30 条清单（「验收」页），然后回写 starter、SPEC 版本 +0.1、记录「复制→上线」耗时。',
        prompts: ['P8'],
      },
    }

    /* -------------------------------------------------------- 侧栏入口按钮 -- */

    function FooterAction(props) {
      const tr = trOf(props && props.t)
      const wide = props && props.wide !== false
      const open = usePanelOpen()
      return h(React.Fragment, null,
        h(Style),
        h('button', {
          type: 'button',
          className: 'dsh-shovel-foot' + (wide ? '' : ' is-compact'),
          title: tr('action.open'),
          onClick: () => setOpen(!open),
        },
          h('span', { 'aria-hidden': 'true' }, '⛏'),
          wide ? h('span', null, tr('action.open')) : null))
    }

    /* -------------------------------------------------------------- 主面板 -- */

    function PanelHost(props) {
      const tr = trOf(props && props.t)
      const open = usePanelOpen()
      if (!open) return null
      return h(React.Fragment, null, h(Style), h(Panel, { tr }))
    }

    function Panel({ tr }) {
      const [tab, setTab] = React.useState('work')
      const [state, setState] = React.useState(null)
      const [error, setError] = React.useState('')
      const [busy, setBusy] = React.useState(false)
      const [mode, setMode] = React.useState('view') // view | new
      const [toast, setToast] = React.useState('')

      const refresh = React.useCallback(async () => {
        try {
          const data = await call('state')
          setState(data)
          setError('')
          return data
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : String(cause))
          return null
        }
      }, [])

      React.useEffect(() => {
        void refresh()
      }, [refresh])

      React.useEffect(() => {
        const onKey = (event) => {
          if (event.key === 'Escape') setOpen(false)
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
      }, [])

      const flash = (message) => {
        setToast(message)
        window.setTimeout(() => setToast(''), 1800)
      }

      const run = async (action, payload) => {
        setBusy(true)
        setError('')
        try {
          const result = await call(action, payload)
          return result
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : String(cause))
          return null
        } finally {
          setBusy(false)
        }
      }

      const projects = (state && state.projects) || []
      const active = projects.find((project) => project.id === (state && state.activeId)) || projects[0]

      const project = active || null
      const stages = (state && state.stages) || []
      const currentStage = project ? stages.find((item) => item.index === Number(project.stage)) || stages[0] : null

      const tabs = [
        ['work', tr('tab.work')],
        ['prompts', tr('tab.prompts')],
        ['verify', tr('tab.verify')],
        ['accept', tr('tab.accept')],
        ['econ', tr('tab.econ')],
        ['docs', tr('tab.docs')],
      ]

      return h('div', {
        className: 'dsh-shovel-scrim',
        role: 'dialog',
        'aria-modal': 'true',
        onMouseDown: (event) => {
          if (event.target === event.currentTarget) setOpen(false)
        },
      }, h('div', { className: 'dsh-shovel-panel' },
        h('header', { className: 'dsh-shovel-head' },
          h('div', { className: 'dsh-shovel-title' }, tr('panel.title')),
          h('div', { className: 'dsh-shovel-head-actions' },
            projects.length > 0
              ? h('select', {
                className: 'dsh-shovel-select',
                value: project ? project.id : '',
                onChange: async (event) => {
                  const value = event.target.value
                  if (value === '__new') {
                    setMode('new')
                    return
                  }
                  await run('project.select', { projectId: value })
                  await refresh()
                },
              },
                projects.map((item) => h('option', { key: item.id, value: item.id }, `${item.name}（第 ${item.stage} 步）`)),
                h('option', { key: '__new', value: '__new' }, '＋ 新建项目…'))
              : null,
            h(Btn, { small: true, onClick: () => setMode(mode === 'new' ? 'view' : 'new') }, tr('action.new')),
            toast !== '' ? h('span', { className: 'dsh-shovel-muted' }, toast) : null,
            h(Btn, { small: true, onClick: () => setOpen(false) }, '✕'))),
        h('nav', { className: 'dsh-shovel-tabs' },
          tabs.map(([key, label]) => h('button', {
            key,
            type: 'button',
            className: 'dsh-shovel-tab' + (tab === key ? ' is-active' : ''),
            onClick: () => setTab(key),
          }, label))),
        h('div', { className: 'dsh-shovel-body' },
          error !== '' ? h('div', { className: 'dsh-shovel-banner is-error' }, error) : null,
          mode === 'new'
            ? h(NewProject, {
              tr,
              busy,
              root: state && state.projectsRoot,
              onCancel: () => setMode('view'),
              onCreate: async (form) => {
                const result = await run('project.create', form)
                if (!result) return
                setMode('view')
                setTab('work')
                flash('骨架已生成')
                await refresh()
              },
            })
            : project === null
              ? h('div', { className: 'dsh-shovel-card' },
                h('div', null, '还没有项目。'),
                h('div', { className: 'dsh-shovel-muted' }, '点「＋ 新建项目」会生成一副能跑起来的骨架：SPEC、冻结区契约、降级链、迁移 SQL、全部文档和提示词。'),
                h('div', { className: 'dsh-shovel-row' },
                  h(Btn, { primary: true, onClick: () => setMode('new') }, tr('action.new'))))
              : tab === 'work'
                ? h(Workbench, { tr, project, stages, currentStage, busy, run, refresh, flash, setTab })
                : tab === 'prompts'
                  ? h(PromptsTab, { tr, project, busy, call, flash })
                  : tab === 'verify'
                    ? h(VerifyTab, { tr, project, busy, run, flash })
                    : tab === 'accept'
                      ? h(AcceptTab, { tr, project, run, refresh })
                      : tab === 'econ'
                        ? h(EconTab, { tr, project, busy, run })
                        : h(DocsTab, { tr, state, busy, call, flash }))))
    }

    /* ------------------------------------------------------------ 新建项目 -- */

    function NewProject({ tr, busy, root, onCancel, onCreate }) {
      const [form, setForm] = React.useState({
        name: '',
        oneLiner: '',
        targetUser: '',
        interaction: '',
        topic: '',
        dir: '',
      })
      const set = (key) => (event) => setForm({ ...form, [key]: event.target.value })
      const fields = [
        ['name', '项目名 *', '例如：小红书封面生成器'],
        ['oneLiner', '一句话主题', '把一段文字转成一张配图'],
        ['targetUser', '目标用户', '做小红书封面的个人创作者'],
        ['interaction', '主交互', '输入框 → 点生成 → 右侧出图 → 可下载'],
        ['topic', '目录名（可选）', '小写英文短词，会进 URL；留空自动生成'],
        ['dir', '目录（可选）', root ? `留空则放在 ${root}\\<目录名>` : '留空用默认目录'],
      ]
      return h('div', { className: 'dsh-shovel-card' },
        h('div', { className: 'dsh-shovel-badge' }, '新建项目'),
        h('div', { className: 'dsh-shovel-form' },
          fields.map(([key, label, placeholder]) => h(React.Fragment, { key },
            h('label', { htmlFor: `shovel-${key}` }, label),
            h('input', {
              id: `shovel-${key}`,
              className: 'dsh-shovel-input',
              value: form[key],
              placeholder,
              onChange: set(key),
            })))),
        h('div', { className: 'dsh-shovel-muted' },
          '生成后你会得到一个能零 key 跑通的全栈骨架。它不会替你写代码——代码由 AI 按 SPEC 和提示词生成，你负责验收。'),
        h('div', { className: 'dsh-shovel-row' },
          h(Btn, {
            primary: true,
            disabled: busy || form.name.trim() === '',
            onClick: () => onCreate(form),
          }, busy ? '正在生成…' : '生成骨架'),
          h(Btn, { onClick: onCancel }, '取消')))
    }

    /* ---------------------------------------------------------------- 工作台 -- */

    function Workbench({ tr, project, stages, currentStage, busy, run, refresh, flash, setTab }) {
      const done = project.tasks || {}
      const next = NEXT_BY_STAGE[Number(project.stage)] || NEXT_BY_STAGE[1]
      const [commands, setCommands] = React.useState('')

      const toggleTask = async (taskId, value) => {
        await run('task.set', { projectId: project.id, taskId, done: value })
        await refresh()
      }
      const setStage = async (index) => {
        await run('task.set', { projectId: project.id, stage: index })
        await refresh()
      }

      React.useEffect(() => {
        let cancelled = false
        if (next.promptId) {
          call('prompt.get', { projectId: project.id, promptId: next.promptId })
            .then((data) => {
              if (!cancelled) setCommands(data.text)
            })
            .catch(() => {})
        }
        return () => {
          cancelled = true
        }
      }, [project.id, next.promptId])

      return h(React.Fragment, null,
        h('div', { className: 'dsh-shovel-card' },
          h('div', { className: 'dsh-shovel-row' },
            h('strong', null, project.name),
            h('span', { className: 'dsh-shovel-badge' }, `第 ${project.stage} 步 · ${project.stageTitle}`),
            h('span', { className: 'dsh-shovel-muted' }, `任务 ${project.done}/${project.total}`)),
          h('div', { className: 'dsh-shovel-row' },
            h('span', { className: 'dsh-shovel-muted dsh-shovel-mono' }, project.dir),
            h(Btn, {
              small: true,
              onClick: async () => {
                const ok = await copyText(project.dir)
                flash(ok ? '目录已复制' : '复制失败')
              },
            }, '复制目录'))),
        h('div', { className: 'dsh-shovel-stages' },
          stages.map((stage) => {
            const stageDone = stage.tasks.filter((task) => done[task.id] === true).length
            const cls = ['dsh-shovel-stage']
            if (stage.index < Number(project.stage)) cls.push('is-done')
            if (stage.index === Number(project.stage)) cls.push('is-current')
            return h('button', {
              key: stage.id,
              type: 'button',
              className: cls.join(' '),
              title: stage.summary,
              onClick: () => setStage(stage.index),
            }, `${stage.title} ${stageDone}/${stage.tasks.length}`)
          })),
        h('div', { className: 'dsh-shovel-card' },
          h('div', { className: 'dsh-shovel-row' },
            h('strong', null, currentStage ? currentStage.title : ''),
            h('span', { className: 'dsh-shovel-muted' }, currentStage ? currentStage.summary : '')),
          h('div', { className: 'dsh-shovel-list' },
            currentStage
              ? currentStage.tasks.map((task) => h('label', {
                key: task.id,
                className: 'dsh-shovel-task' + (done[task.id] === true ? ' is-done' : ''),
              },
                h('input', {
                  type: 'checkbox',
                  checked: done[task.id] === true,
                  disabled: busy,
                  onChange: (event) => toggleTask(task.id, event.target.checked),
                }),
                h('span', null, `${task.label}`)))
              : null)),
        h('div', { className: 'dsh-shovel-card' },
          h('div', { className: 'dsh-shovel-row' },
            h('span', { className: 'dsh-shovel-badge' }, '下一步'),
            h('strong', null, next.title)),
          h('div', { className: 'dsh-shovel-muted' }, next.hint),
          next.commands
            ? h('div', { className: 'dsh-shovel-list' },
              next.commands.map((command) => h('div', { key: command, className: 'dsh-shovel-row' },
                h('code', { className: 'dsh-shovel-mono' }, command),
                h(Btn, {
                  small: true,
                  onClick: async () => {
                    const ok = await copyText(command)
                    flash(ok ? '已复制命令' : '复制失败')
                  },
                }, '复制'))))
            : null,
          next.promptId
            ? h('div', { className: 'dsh-shovel-row' },
              h(Btn, {
                primary: true,
                onClick: async () => {
                  const ok = await copyText(commands || '')
                  flash(ok ? '开工三件套已复制，贴给 AI 即可' : '复制失败')
                },
              }, '复制「开工三件套」'),
              h(Btn, { onClick: () => setTab('prompts') }, '看全文'))
            : null,
          next.prompts
            ? h('div', { className: 'dsh-shovel-row' },
              next.prompts.map((id) => h(Btn, {
                key: id,
                onClick: async () => {
                  const data = await call('prompt.get', { projectId: project.id, promptId: id })
                  const ok = await copyText(data.text)
                  flash(ok ? `${id} 已复制` : '复制失败')
                },
              }, `复制 ${id}`)),
              h(Btn, { onClick: () => setTab('prompts') }, '看全文'))
            : null))
    }

    /* ---------------------------------------------------------------- 提示词 -- */

    function PromptsTab({ tr, project, busy, call, flash }) {
      const [list, setList] = React.useState([])
      const [picked, setPicked] = React.useState('kickoff')
      const [text, setText] = React.useState('')
      const [loading, setLoading] = React.useState(false)

      const ids = React.useMemo(() => ([
        { id: 'kickoff', title: '开工三件套（SPEC + P0 + P1）' },
        { id: 'spec', title: 'SPEC 骨架规格' },
        { id: 'P0', title: 'P0 · 总指令' },
        { id: 'P1', title: 'P1 · 生成新项目' },
        { id: 'P2', title: 'P2 · 接通登录' },
        { id: 'P3', title: 'P3 · 接通数据库' },
        { id: 'P4', title: 'P4 · 支付与点数' },
        { id: 'P5', title: 'P5 · 真引擎 + Fallback' },
        { id: 'P6', title: 'P6 · pSEO 批量建页' },
        { id: 'P7', title: 'P7 · 部署核对' },
        { id: 'P8', title: 'P8 · 上线前验收' },
      ]), [])

      React.useEffect(() => {
        let cancelled = false
        setLoading(true)
        call('prompt.get', { projectId: project.id, promptId: picked })
          .then((data) => {
            if (!cancelled) setText(data.text)
          })
          .catch((cause) => {
            if (!cancelled) setText(`读取失败：${cause.message}`)
          })
          .finally(() => {
            if (!cancelled) setLoading(false)
          })
        return () => {
          cancelled = true
        }
      }, [project.id, picked, call])

      return h('div', { className: 'dsh-shovel-two' },
        h('div', { className: 'dsh-shovel-menu' },
          ids.map((item) => h('button', {
            key: item.id,
            type: 'button',
            className: 'dsh-shovel-menu-item' + (picked === item.id ? ' is-active' : ''),
            onClick: () => setPicked(item.id),
          }, item.title))),
        h('div', { className: 'dsh-shovel-card', style: { minWidth: 0 } },
          h('div', { className: 'dsh-shovel-row' },
            h('strong', null, (ids.find((item) => item.id === picked) || {}).title || picked),
            h(Btn, {
              small: true,
              primary: true,
              onClick: async () => {
                const ok = await copyText(text)
                flash(ok ? '已复制，贴给 AI Coding 工具即可' : '复制失败')
              },
            }, '复制全文'),
            loading ? h('span', { className: 'dsh-shovel-muted' }, '读取中…') : null),
          h('pre', { className: 'dsh-shovel-pre' }, text)))
    }

    /* ------------------------------------------------------------------ 体检 -- */

    function VerifyTab({ tr, project, busy, run, flash }) {
      const [result, setResult] = React.useState(null)
      const [running, setRunning] = React.useState(false)

      const execute = async () => {
        setRunning(true)
        const data = await run('verify.run', { projectId: project.id })
        setRunning(false)
        if (data) setResult(data)
      }

      const groups = result
        ? result.checks.reduce((acc, check) => {
          const key = check.group || '骨架'
          acc[key] = acc[key] || []
          acc[key].push(check)
          return acc
        }, {})
        : {}

      return h(React.Fragment, null,
        h('div', { className: 'dsh-shovel-card' },
          h('div', { className: 'dsh-shovel-row' },
            h('strong', null, '静态体检'),
            h('span', { className: 'dsh-shovel-muted' }, '检查冻结区、密钥、降级链、env 填充度、git 与工具链'),
            h(Btn, { primary: true, disabled: running || busy, onClick: execute }, running ? '体检中…' : tr('action.run'))),
          result
            ? h('div', { className: 'dsh-shovel-row' },
              h('span', { className: 'dsh-shovel-badge' }, `得分 ${result.score}`),
              h('span', { className: 'dsh-shovel-muted' }, `通过 ${result.counts.pass} · 告警 ${result.counts.warn} · 不通过 ${result.counts.fail} · 跳过 ${result.counts.skip}`),
              h('span', { className: 'dsh-shovel-muted' }, result.ok ? '没有硬伤，可以继续下一步。' : '先修 ✗ 的项，别往下走。'))
            : h('span', { className: 'dsh-shovel-muted' }, '还没跑过体检。')),
        result
          ? Object.entries(groups).map(([group, checks]) => h('div', { key: group, className: 'dsh-shovel-card' },
            h('div', { className: 'dsh-shovel-badge' }, group),
            h('div', { className: 'dsh-shovel-list' },
              checks.map((check) => h('div', {
                key: check.id,
                className: `dsh-shovel-item is-${check.status}`,
              },
                h('span', { className: `dsh-shovel-mark is-${check.status}` },
                  check.status === 'pass' ? '✓' : check.status === 'warn' ? '!' : check.status === 'skip' ? '–' : '✗'),
                h('div', { style: { minWidth: 0 } },
                  h('div', null, check.title),
                  h('div', { className: 'dsh-shovel-muted dsh-shovel-mono' }, check.detail),
                  check.status !== 'pass' && check.fix
                    ? h('div', { className: 'dsh-shovel-muted' }, `修法：${check.fix}`)
                    : null))))))
          : null)
    }

    /* ------------------------------------------------------------------ 验收 -- */

    function AcceptTab({ tr, project, run, refresh }) {
      const [state, setState] = React.useState(null)
      const [busy, setBusy] = React.useState(false)

      const load = React.useCallback(async () => {
        const data = await run('accept.save', { projectId: project.id })
        if (data) setState(data)
      }, [project.id])

      React.useEffect(() => {
        void load()
      }, [load])

      const mark = async (id, value) => {
        setBusy(true)
        const data = await run('accept.save', { projectId: project.id, results: { [id]: value } })
        setBusy(false)
        if (data) setState(data)
      }

      if (state === null) return h('div', { className: 'dsh-shovel-muted' }, '读取清单…')

      const groups = state.items.reduce((acc, item) => {
        acc[item.group] = acc[item.group] || []
        acc[item.group].push(item)
        return acc
      }, {})

      const cycle = { unset: 'pass', pass: 'fail', fail: 'na', na: 'unset' }

      return h(React.Fragment, null,
        h('div', { className: 'dsh-shovel-card' },
          h('div', { className: 'dsh-shovel-row' },
            h('strong', null, '30 条上线验收清单'),
            h('span', { className: 'dsh-shovel-badge' },
              state.verdict === 'allowed' ? '允许上线'
                : state.verdict === 'incomplete' ? `还不能上线（剩 ${state.counts.unset} 条）`
                  : '不允许上线'),
            h('span', { className: 'dsh-shovel-muted' },
              `通过 ${state.counts.pass} · 不通过 ${state.counts.fail} · 不适用 ${state.counts.na} · 未记录 ${state.counts.unset}`)),
          h('div', { className: 'dsh-shovel-muted' },
            '点一下循环切换：未记录 → 通过 → 不通过 → 不适用。硬门槛（标 ★）不通过就不许对外发链接。')),
        Object.entries(groups).map(([group, items]) => h('div', { key: group, className: 'dsh-shovel-card' },
          h('div', { className: 'dsh-shovel-badge' }, group),
          h('div', { className: 'dsh-shovel-list' },
            items.map((item) => h('div', {
              key: item.id,
              className: `dsh-shovel-item ${item.result === 'pass' ? 'is-pass' : item.result === 'fail' ? 'is-fail' : item.result === 'na' ? '' : 'is-warn'}`,
            },
              h('span', { className: `dsh-shovel-mark is-${item.result === 'pass' ? 'pass' : item.result === 'fail' ? 'fail' : item.result === 'na' ? 'skip' : 'warn'}` },
                item.result === 'pass' ? '✓' : item.result === 'fail' ? '✗' : item.result === 'na' ? '–' : '·'),
              h('div', { style: { minWidth: 0, flex: 1 } },
                h('div', null, `${item.id} ${item.text}${item.hard ? ' ★' : ''}`),
                h('div', { className: 'dsh-shovel-muted' }, `当前：${item.result === 'pass' ? '通过' : item.result === 'fail' ? '不通过' : item.result === 'na' ? '不适用' : '未记录'}`)),
              h(Btn, {
                small: true,
                disabled: busy,
                onClick: () => mark(item.id, cycle[item.result] || 'pass'),
              }, '标记')))))))
    }

    /* ------------------------------------------------------------------ 算账 -- */

    function EconTab({ tr, project, busy, run }) {
      const [form, setForm] = React.useState({
        priceYuan: 1,
        enginePerCall: 0.02,
        callsPerTask: 1.3,
        storagePerTask: 0.01,
        paymentPct: 5,
        payRatePct: 1,
        cacYuan: 0,
      })
      const [result, setResult] = React.useState(null)
      const [computing, setComputing] = React.useState(false)

      const fields = [
        ['priceYuan', '每单售价（元）'],
        ['enginePerCall', '引擎单价（元/次）'],
        ['callsPerTask', '平均调用次数/任务'],
        ['storagePerTask', '存储+带宽（元/单）'],
        ['paymentPct', '支付抽成（%）'],
        ['payRatePct', '付费转化率（%）'],
        ['cacYuan', '获客成本（元/人）'],
      ]

      const compute = async () => {
        setComputing(true)
        const data = await run('economics.compute', { projectId: project.id, ...form })
        setComputing(false)
        if (data) setResult(data.economics)
      }

      return h(React.Fragment, null,
        h('div', { className: 'dsh-shovel-card' },
          h('div', { className: 'dsh-shovel-row' },
            h('strong', null, '单位经济测算'),
            h('span', { className: 'dsh-shovel-muted' }, '定价前必须算清楚：单次成本 × 调用量 ≤ 定价')),
          h('div', { className: 'dsh-shovel-econ' },
            fields.map(([key, label]) => h(React.Fragment, { key },
              h('label', null, label),
              h('input', {
                className: 'dsh-shovel-input',
                type: 'number',
                step: '0.01',
                value: form[key],
                onChange: (event) => setForm({ ...form, [key]: event.target.value }),
              })))),
          h('div', { className: 'dsh-shovel-row' },
            h(Btn, { primary: true, disabled: computing || busy, onClick: compute }, computing ? '计算中…' : '算一遍'))),
        result
          ? h('div', { className: 'dsh-shovel-card' },
            h('div', { className: 'dsh-shovel-row' },
              h('span', { className: `dsh-shovel-badge` }, result.ok ? '算式成立' : '算式不成立'),
              h('span', { className: 'dsh-shovel-muted' }, `单次成本 ${result.costPerTask} 元 · 单笔毛利 ${result.margin} 元（${result.marginPct}%）`)),
            h('div', { className: 'dsh-shovel-econ' },
              h('span', { className: 'dsh-shovel-muted' }, '引擎成本'), h('span', null, `${result.engineCost} 元`),
              h('span', { className: 'dsh-shovel-muted' }, '支付抽成'), h('span', null, `${result.paymentCost} 元`),
              h('span', { className: 'dsh-shovel-muted' }, '盈亏平衡获客成本'), h('span', null, `${result.breakEvenCac} 元`),
              h('span', { className: 'dsh-shovel-muted' }, '每 1000 访客期望毛利'), h('span', null, `${result.thousandProfit} 元`)),
            h('div', { className: 'dsh-shovel-list' },
              result.notes.map((note) => h('div', { key: note, className: 'dsh-shovel-muted' }, `· ${note}`))))
          : null)
    }

    /* ------------------------------------------------------------------ 手册 -- */

    function DocsTab({ tr, state, busy, call, flash }) {
      const [picked, setPicked] = React.useState('01_全栈开发SOP.md')
      const [text, setText] = React.useState('')
      const docs = (state && state.docs) || []
      const loading = React.useRef(false)

      React.useEffect(() => {
        let cancelled = false
        loading.current = true
        call('doc.get', { name: picked })
          .then((data) => {
            if (!cancelled) setText(data.text)
          })
          .catch((cause) => {
            if (!cancelled) setText(`读取失败：${cause.message}`)
          })
        return () => {
          cancelled = true
        }
      }, [picked, call])

      return h('div', { className: 'dsh-shovel-two' },
        h('div', { className: 'dsh-shovel-menu' },
          docs.map((doc) => h('button', {
            key: doc.name,
            type: 'button',
            className: 'dsh-shovel-menu-item' + (picked === doc.name ? ' is-active' : ''),
            onClick: () => setPicked(doc.name),
          }, doc.title))),
        h('div', { className: 'dsh-shovel-card', style: { minWidth: 0 } },
          h('div', { className: 'dsh-shovel-row' },
            h('strong', null, (docs.find((doc) => doc.name === picked) || {}).title || picked),
            h(Btn, {
              small: true,
              onClick: async () => {
                const ok = await copyText(text)
                flash(ok ? '已复制全篇' : '复制失败')
              },
            }, '复制全文')),
          h('pre', { className: 'dsh-shovel-pre' }, text)))
    }

    /* ---------------------------------------------------------------- 注册 -- */

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => {
          try {
            return ctx.locale.register(NS, DICT)
          } catch {
            return () => {}
          }
        }, 'dsh-shovel: dictionaries')

        try {
          ctx.slots.inject(FOOTER_SLOT, () => ctx.slots.register({
            name: FOOTER_SLOT,
            id: 'dsh-shovel.footer',
            order: 880,
            locale: NS,
          }, FooterAction))
        } catch {
          /* 没有侧栏就不挂入口 */
        }

        try {
          ctx.slots.inject(OVERLAY_SLOT, () => ctx.slots.register({
            name: OVERLAY_SLOT,
            id: 'dsh-shovel.panel',
            order: 920,
            locale: NS,
          }, PanelHost))
        } catch {
          /* 没有覆盖层就不挂面板 */
        }
      },
    }
  },
})
