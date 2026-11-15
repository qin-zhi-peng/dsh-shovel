/**
 * 假引擎：不填任何 API key 也能把「登录 → 扣点 → 生成 → 展示 → 支付」整条链路跑通。
 * 骨架里的救命文件，永远保留，永远挂在降级链最后一级。
 */
import type { EngineAdapter, GenInput, GenResult } from './types'

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export const mockAdapter: EngineAdapter = {
  name: 'mock',

  estimateCost() {
    return 0
  },

  async generate(input: GenInput, signal: AbortSignal): Promise<GenResult> {
    // 模拟一点延迟，让加载态、骨架屏、超时路径都能被真实点到。
    await sleep(320)
    if (signal.aborted) throw new Error('MOCK_ABORTED')
    const prompt = input.prompt.trim()
    return {
      kind: 'text',
      data: `【mock 结果】已收到输入：${prompt.slice(0, 120)}${prompt.length > 120 ? '…' : ''}`,
      meta: { adapter: 'mock', note: '零 key 假数据，仅用于跑通链路' },
    }
  },
}

export default mockAdapter
