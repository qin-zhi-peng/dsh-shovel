/**
 * 统一适配器接口 —— 骨架里最值钱的一个文件，任何项目都不许改。
 *
 * 规则（SPEC §3）：
 *  - 每个 AI 能力实现本接口，一个引擎一个文件；
 *  - 业务代码只认 EngineAdapter，不 import 任何厂商 SDK；
 *  - 调用一律走 src/core/fallback/run-with-fallback.ts，链末必须有 mock。
 */
export type GenInput = {
  prompt: string
  userId: string
  options?: Record<string, unknown>
}

export type GenResult = {
  kind: 'text' | 'image' | 'audio' | 'url'
  data: string
  meta?: Record<string, unknown>
}

export interface EngineAdapter {
  name: string
  /** 单次调用预估成本（元），用于成本阀与留痕。 */
  estimateCost(input: GenInput): number
  /** 真正调用；必须尊重 signal，超时由 fallback 链统一处理。 */
  generate(input: GenInput, signal: AbortSignal): Promise<GenResult>
}
