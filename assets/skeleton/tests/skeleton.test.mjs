// 骨架自带的冒烟测试：保证「降级链末尾永远挂着 mock」这条铁律不被 AI 改坏。
// 跑法：pnpm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { readdir } from 'node:fs/promises'

const read = (p) => readFile(new URL(`../${p}`, import.meta.url), 'utf8')

test('适配器统一接口存在，且没有厂商 SDK 泄漏进去', async () => {
  const types = await read('src/adapters/types.ts')
  assert.match(types, /interface EngineAdapter/)
  assert.match(types, /estimateCost/)
  assert.match(types, /generate\(/)
})

test('mock 适配器永远存在', async () => {
  const mock = await read('src/adapters/mock.ts')
  assert.match(mock, /name: 'mock'/)
})

test('降级链数组末尾必须是 mock', async () => {
  const index = await read('src/adapters/index.ts')
  const chain = index.match(/ADAPTERS[^=]*=\s*\[([^\]]*)\]/)
  assert.ok(chain, '没找到 ADAPTERS 数组')
  const items = chain[1].split(',').map((s) => s.trim()).filter(Boolean)
  assert.ok(items.length > 0, 'ADAPTERS 不能为空')
  assert.match(items[items.length - 1], /mock/, '降级链最后一级必须是 mock')
})

test('降级执行器写着 ALL_ENGINES_DOWN（失败不假装成功）', async () => {
  const chain = await read('src/core/fallback/run-with-fallback.ts')
  assert.match(chain, /ALL_ENGINES_DOWN/)
})

test('迁移 SQL 里订单表有幂等唯一键', async () => {
  const sql = await read('supabase/migrations/0001_init.sql')
  assert.match(sql, /provider_event_id text unique/)
})

test('src 目录里不存在直接 import 厂商 SDK 的业务文件', async () => {
  const entries = await readdir(new URL('../src/apps', import.meta.url), { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    assert.ok(entry.isDirectory(), 'src/apps 下应当只有本次产品的目录')
  }
})
