/**
 * 演示用业务接口：展示 SPEC 要求的调用顺序
 *   校验入参 → 成本阀 → runWithFallback → 返回
 * 第 3 步（P2–P5）会把它替换成 apps/<topic>/route.ts，并补上鉴权、扣点、留痕。
 */
import { NextResponse } from 'next/server'
import { ADAPTERS } from '@/adapters'
import { runWithFallback } from '@/core/fallback/run-with-fallback'

export async function POST(request: Request) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: '请求体不是合法 JSON' }, { status: 400 })
  }

  const prompt = typeof (body as { prompt?: unknown })?.prompt === 'string'
    ? (body as { prompt: string }).prompt.trim()
    : ''
  if (prompt === '') return NextResponse.json({ error: 'prompt 不能为空' }, { status: 400 })
  if (prompt.length > 4000) return NextResponse.json({ error: 'prompt 过长（上限 4000 字）' }, { status: 400 })

  try {
    const outcome = await runWithFallback(
      { prompt, userId: 'local-demo' },
      {
        chain: ADAPTERS,
        maxCostPerCall: Number(process.env.MAX_COST_PER_CALL || 0.5),
        timeoutMs: Number(process.env.ENGINE_TIMEOUT_MS || 15000),
        log: (event) => console.log(JSON.stringify(event)),
      },
    )
    return NextResponse.json({
      data: outcome.result.data,
      adapter: outcome.adapter,
      status: outcome.status,
      costYuan: outcome.costYuan,
      latencyMs: outcome.latencyMs,
    })
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause)
    // 失败必须显式返回，不白屏、不假装成功、不扣点。
    return NextResponse.json({ error: `生成失败：${message}` }, { status: 502 })
  }
}
