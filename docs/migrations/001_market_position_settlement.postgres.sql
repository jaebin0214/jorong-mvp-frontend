-- 조롱 거래소 투자·포지션·정산 원장
-- 전제: 기존 사용자 테이블 이름은 users, PK 타입은 uuid입니다. 실제 프로젝트의 사용자 테이블/타입에 맞게 FK만 조정하세요.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS markets (
  id text PRIMARY KEY,
  target_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('SCHEDULED', 'OPEN', 'CLOSED', 'SETTLED')),
  open_at timestamptz NOT NULL,
  close_at timestamptz NOT NULL,
  next_open_at timestamptz,
  initial_price numeric(20, 8) NOT NULL CHECK (initial_price > 0),
  current_price numeric(20, 8) NOT NULL CHECK (current_price > 0),
  close_price numeric(20, 8),
  settled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (close_at > open_at),
  CHECK (close_price IS NULL OR close_price > 0)
);

CREATE TABLE IF NOT EXISTS investment_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  market_id text NOT NULL REFERENCES markets(id),
  side text NOT NULL CHECK (side IN ('SUPPORT', 'MOCK')),
  investment_amount bigint NOT NULL CHECK (investment_amount > 0),
  execution_price numeric(20, 8) NOT NULL CHECK (execution_price > 0),
  added_quantity numeric(28, 12) NOT NULL CHECK (added_quantity > 0),
  idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, market_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS investment_orders_market_created_idx
  ON investment_orders (market_id, created_at);

CREATE TABLE IF NOT EXISTS positions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  market_id text NOT NULL REFERENCES markets(id),
  side text NOT NULL CHECK (side IN ('SUPPORT', 'MOCK')),
  total_investment bigint NOT NULL CHECK (total_investment > 0),
  quantity numeric(28, 12) NOT NULL CHECK (quantity > 0),
  average_price numeric(20, 8) NOT NULL CHECK (average_price > 0),
  status text NOT NULL CHECK (status IN ('OPEN', 'SETTLED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, market_id)
);

CREATE INDEX IF NOT EXISTS positions_market_status_idx
  ON positions (market_id, status);

CREATE TABLE IF NOT EXISTS settlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  market_id text NOT NULL REFERENCES markets(id),
  position_id uuid NOT NULL REFERENCES positions(id),
  close_price numeric(20, 8) NOT NULL CHECK (close_price > 0),
  realized_pnl numeric(28, 8) NOT NULL,
  pnl_rate numeric(20, 8) NOT NULL,
  settlement_amount bigint NOT NULL CHECK (settlement_amount >= 0),
  balance_after_settlement bigint NOT NULL CHECK (balance_after_settlement >= 0),
  settled_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, market_id),
  UNIQUE (position_id)
);

CREATE TABLE IF NOT EXISTS wallet_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  market_id text REFERENCES markets(id),
  type text NOT NULL CHECK (type IN ('INITIAL_GRANT', 'INVESTMENT', 'SETTLEMENT')),
  amount bigint NOT NULL,
  reference_id uuid,
  balance_after bigint NOT NULL CHECK (balance_after >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS wallet_transactions_user_created_idx
  ON wallet_transactions (user_id, created_at DESC);

COMMIT;

-- 주문 트랜잭션 의사 코드 (서비스 계층에서 구현)
-- 1) markets / users / positions 행을 SELECT ... FOR UPDATE
-- 2) server_now < markets.close_at AND markets.status = 'OPEN' 검증
-- 3) side가 기존 positions.side와 다르면 POSITION_LOCKED
-- 4) wallet balance 조건부 차감, investment_orders INSERT, positions UPSERT, wallet_transactions INSERT
-- 5) 현재가·캔들 집계 갱신 후 COMMIT
-- 정산 작업도 markets 행을 잠근 뒤 close_price를 한 번만 확정하고,
-- settlements UNIQUE(user_id, market_id)와 wallet_transactions를 같은 트랜잭션에서 기록해야 합니다.
