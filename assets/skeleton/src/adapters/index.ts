/**
 * 降级链组装：业务代码只 import 这个文件，不直接接触任何厂商 SDK。
 *
 * 顺序约定：[primary, secondary, mock]，mock 永远在最后一级。
 * 接真引擎（P5）时只在数组里加项，不改调用方。
 */
import type { EngineAdapter } from './types'
import { mockAdapter } from './mock'

/** 从环境变量拿主/备引擎名；没配就只剩 mock —— 零 key 也能跑。 */
const primary = process.env.PRIMARY_ADAPTER
const secondary = process.env.SECONDARY_ADAPTER

export const ADAPTERS: EngineAdapter[] = [mockAdapter]

// 真引擎的接入点：P5 生成 adapters/<name>.ts 后，在这里按名字挂上来。
// 例：import { openrouterAdapter } from './openrouter'
//     ADAPTERS = [openrouterAdapter, replicateAdapter, mockAdapter]
export const RESERVED = { primary, secondary }

export default ADAPTERS
