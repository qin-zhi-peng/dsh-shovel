'use client'

/**
 * 骨架落地页：这一步刻意不接任何真 AI 引擎、不接登录与支付。
 * 目的只是让你第一次打开 localhost:3000 时，亲眼看到
 * 「输入 → 生成 → 展示 → 失败有提示」这条链路是通的。
 * 第 2 步让 AI 按 P1 把它改成本次产品的主交互页。
 */
import { useState } from 'react'

export default function HomePage() {
  const [prompt, setPrompt] = useState('')
  const [result, setResult] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function generate() {
    if (busy) return
    setBusy(true)
    setError('')
    setResult('')
    try {
      const response = await fetch('/api/mock-generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data?.error || `HTTP ${response.status}`)
      setResult(String(data?.data ?? ''))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="shell">
      <div className="eyebrow">mock 链路 · 零 API key</div>
      <h1>输入一句话，看到这条链路是通的</h1>
      <p className="lead">
        这是骨架自带的演示页。它用降级链最末端的 mock 引擎返回假结果，
        用来验证前端、接口、适配器、降级器四层都装对了。
      </p>
      <section className="card">
        <textarea
          value={prompt}
          placeholder="例如：把这段文字转成一张小红书封面"
          onChange={(event) => setPrompt(event.target.value)}
        />
        <div className="row">
          <button type="button" disabled={busy || prompt.trim() === ''} onClick={generate}>
            {busy ? '生成中…' : '生成'}
          </button>
          <span className="hint">不花钱、不联网、不需要任何 key</span>
        </div>
        {error !== '' ? <div className="result is-error">{error}</div> : null}
        {result !== '' ? <div className="result is-ok">{result}</div> : null}
      </section>
    </main>
  )
}
