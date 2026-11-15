-- 最小数据表：够用就别加字段（SPEC §4）
-- 口径：点数「冻结 → 生成成功才扣 → 失败回滚」；支付 webhook 幂等。

create extension if not exists pgcrypto;

-- 用户与点数（外部登录系统的 user_id 作主键）
create table if not exists profiles (
  user_id text primary key,
  credits integer not null default 0,
  created_at timestamptz not null default now()
);

-- 订单 / 支付回调幂等：provider_event_id 唯一，重放直接跳过
create table if not exists orders (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  provider_event_id text unique not null,
  amount_cents integer not null,
  credits_added integer not null,
  created_at timestamptz not null default now()
);

-- 每次生成留痕：算成本、查故障、复盘都靠它
create table if not exists generations (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  adapter text not null,
  cost_yuan numeric(10, 4) not null default 0,
  latency_ms integer not null,
  status text not null check (status in ('ok', 'failed', 'fallback')),
  created_at timestamptz not null default now()
);

create index if not exists generations_user_day_idx
  on generations (user_id, created_at desc);

-- 成本看板的最小查询：按天汇总次数 / 总成本 / 失败与降级
-- select date_trunc('day', created_at) as day,
--        count(*) as calls,
--        sum(cost_yuan) as cost,
--        count(*) filter (where status = 'failed') as failed,
--        count(*) filter (where status = 'fallback') as fallback
--   from generations
--  group by 1 order by 1 desc;

-- RLS 或等价的服务端保护（按你的登录方案选一种启用）
-- alter table profiles enable row level security;
-- create policy profiles_self_read on profiles
--   for select using (auth.uid()::text = user_id);
