/**
 * 统一的降级执行器：超时 + 成本阀 + 逐级降级 + 失败留痕。
 * 对应 SPEC §3 的四条硬约束，任何业务接口都走这里，不许自己 try/catch 吞掉。
 */
import type { EngineAdapter, GenInput, GenResult } from '../../adapters/types'

export type FallbackOutcome = {
  result: GenResult
  adapter: string
  costYuan: number
  latencyMs: number
  status: 'ok' | 'fallback'
  errors: string[]
}

export type FallbackOptions = {
  chain: EngineAdapter[]
  maxCostPerCall?: number
  timeoutMs?: number
  maxRetries?: number
  log?: (event: Record<string, unknown>) => void
}

const DEFAULTS = { maxCostPerCall: 0.5, timeoutMs: 15000, maxRetries: 1 }

export async function runWithFallback(
  input: GenInput,
  options: FallbackOptions,
): Promise<FallbackOutcome> {
  const maxCost = options.maxCostPerCall ?? DEFAULTS.maxCostPerCall
  const timeoutMs = options.timeoutMs ?? DEFAULTS.timeoutMs
  const maxRetries = options.maxRetries ?? DEFAULTS.maxRetries
  const errors: string[] = []
  const startedAt = Date.now()

  for (const [index, adapter] of options.chain.entries()) {
    // ① 成本阀：超预算直接跳过这一级，但不会因为主引擎太贵就整个请求失败。
    const estimate = adapter.estimateCost(input)
    if (estimate > maxCost) {
      errors.push(`${adapter.name}: cost ${estimate} > ${maxCost}`)
      continue
    }

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeoutMs)
      try {
        const result = await adapter.generate(input, controller.signal)
        clearTimeout(timer)
        const outcome: FallbackOutcome = {
          result,
          adapter: adapter.name,
          costYuan: estimate,
          latencyMs: Date.now() - startedAt,
          status: index === 0 ? 'ok' : 'fallback',
          errors,
        }
        // ③ 留痕交给上层写 generations 表；这里只保证不静默。
        options.log?.({
          event: 'engine.ok',
          adapter: adapter.name,
          costYuan: outcome.costYuan,
          latencyMs: outcome.latencyMs,
          status: outcome.status,
        })
        return outcome
      } catch (error) {
        clearTimeout(timer)
        const message = error instanceof Error ? error.message : String(error)
        errors.push(`${adapter.name}#${attempt}: ${message}`)
        options.log?.({ event: 'engine.fail', adapter: adapter.name, attempt, message })
      }
    }
  }

  // ④ 全部失败时明确失败，绝不假装成功、绝不扣点。
  throw new Error(`ALL_ENGINES_DOWN: ${errors.join(' | ')}`)
}
