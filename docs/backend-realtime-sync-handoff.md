# 투자 화면·실시간 그래프 동기화 요청서

작성일: 2026-08-19  
대상: 백엔드/Supabase 담당자

## 1. 이번 프론트 보완 내용

프론트는 다음 문제를 방어하도록 수정되었습니다.

- 10초 포트폴리오 폴링 응답이 주문 성공 응답보다 늦게 도착해도, 추가 투자 입력 화면을 과거의 투자 현황 카드로 되돌리지 않습니다.
- 계정 전환 또는 시장 전환 전에 시작된 요청은 화면에 반영하지 않습니다.
- 동일 시장에서 서버가 이전 `revision` 또는 더 적은 캔들·누적 거래량을 반환하면, 직전에 확인한 그래프를 유지합니다.

이는 화면이 흔들리는 현상을 줄이는 보호 장치입니다. **주문·가격·잔액의 최종 진실은 반드시 서버 트랜잭션과 서버 응답이어야 합니다.**

## 2. 반드시 맞춰야 하는 주문 RPC

현재 프론트 호출:

```text
place_order(
  p_market_id,
  p_side,                 -- SUPPORT | MOCK
  p_investment_amount,    -- 정수 크레딧
  p_idempotency_key
)
```

`place_order`는 다음을 하나의 DB 트랜잭션으로 처리해야 합니다.

1. 로그인 사용자, 시장 상태(`OPEN`), `close_at`, 금액, 잔액, 최초 선택 의견을 검증합니다.
2. 시장·지갑·포지션 행을 잠그고 주문을 생성합니다.
3. 지갑 차감, 주문 저장, 포지션 수량/가중평균 갱신, 현재 가격 갱신, 캔들 원장 반영을 함께 확정합니다.
4. `(user_id, market_id, idempotency_key)` UNIQUE로 같은 요청의 중복 차감을 방지합니다.
5. 커밋된 최신 상태를 아래 응답 형식으로 반환합니다.

권장 성공 응답:

```json
{
  "market": {
    "id": "market-4",
    "status": "OPEN",
    "currentPrice": "1050",
    "basePrice": "1000",
    "revision": 42
  },
  "wallet": { "points": 7000 },
  "target": {
    "id": "target-4",
    "value": "1050",
    "initialPrice": "1000"
  },
  "order": {
    "id": "order-uuid",
    "side": "SUPPORT",
    "investmentAmount": "3000",
    "executionPrice": "1000",
    "addedQuantity": "3",
    "createdAt": "2026-08-19T12:00:00.000Z"
  },
  "position": {
    "id": "position-uuid",
    "side": "SUPPORT",
    "totalInvestment": "3000",
    "quantity": "3",
    "averagePrice": "1000",
    "status": "OPEN",
    "updatedAt": "2026-08-19T12:00:00.000Z"
  },
  "positionMetrics": {
    "currentPrice": "1050",
    "unrealizedPnl": "150",
    "pnlRate": "5",
    "estimatedSettlementAmount": "3150"
  },
  "marketSummary": {
    "supportInvestment": "3000",
    "mockInvestment": "0",
    "totalVolume": "3000"
  }
}
```

프론트는 현재 camelCase를 기본으로 사용합니다. SQL 원본 컬럼을 전달해야 하면 시간 필드와 최초 가격은 일부 snake_case 호환이 있지만, `position`, `wallet`, `target`, `positionMetrics`는 위 형식으로 맞춰 주세요.

오류는 다음처럼 코드와 문구를 함께 반환해 주세요.

```text
INSUFFICIENT_BALANCE: 보유 크레딧이 부족합니다.
POSITION_LOCKED: 한 번 선택한 의견은 장 종료까지 변경할 수 없습니다.
MARKET_CLOSED: 거래가 종료되었습니다.
DUPLICATE_ORDER: 이미 처리된 투자 요청입니다.
```

## 3. 포트폴리오 조회 RPC

현재 프론트 호출:

```text
get_my_position(p_market_id)
```

`place_order` 성공 직후와 이후 주기 갱신 모두에서, **같은 커밋 또는 그 이후 상태**를 반환해야 합니다.

- 주문 직후 `position: null` 또는 이전 `totalInvestment`를 반환하면 프론트가 보호 처리를 하더라도 다음 UI 갱신이 지연됩니다.
- 투자 취소·부분 매도가 없는 현 구조에서 `position.totalInvestment`, `position.quantity`는 같은 시장 안에서 감소하면 안 됩니다.
- 해당 사용자가 투자하지 않은 경우에만 `position: null`을 반환합니다.
- 장 종료 후에는 정산 API의 계약에 따라 `position.status`, `settlement`을 함께 반환합니다.

권장: 응답 `market.revision`을 주문 커밋마다 증가시키고, 조회 응답에 `asOf`(서버 기준 ISO 시각)를 넣어 주세요. 프론트는 더 높은 revision을 최신 데이터로 판단할 수 있습니다.

## 4. 캔들 RPC

현재 프론트 호출:

```text
get_market_candles(
  p_market_id,
  p_interval_seconds -- 5 | 10 | 15 | 30 | 60
)
```

필수 응답:

```json
{
  "marketSessionId": "market-4",
  "initialPrice": 1000,
  "revision": 42,
  "asOf": "2026-08-19T12:00:01.000Z",
  "candles": [
    {
      "startedAt": "2026-08-19T12:00:00.000Z",
      "endedAt": "2026-08-19T12:00:30.000Z",
      "open": 1000,
      "high": 1050,
      "low": 1000,
      "close": 1050,
      "volume": 3000
    }
  ]
}
```

집계 규칙:

- 현재 로그인 사용자만이 아니라 **해당 시장의 모든 확정 주문**을 시간순으로 집계합니다.
- `open`은 구간 첫 체결 후 가격, `high`는 구간 최고가, `low`는 구간 최저가, `close`는 구간 마지막 체결 후 가격입니다.
- `volume`은 그 구간의 총 투자 크레딧입니다.
- 캔들 시간은 시장 시작 시각을 기준으로 `p_interval_seconds` 구간에 맞춥니다.
- 응답은 시간 오름차순이어야 하며, 같은 market·revision에서 기존 캔들이 사라지거나 누적 거래량이 감소하면 안 됩니다.
- `initialPrice`는 DB의 `base_price`를 전달해 주세요. 프론트 차트 중앙 기준선과 변동률 기준은 이 값입니다.

현재 프론트는 서버 연결 시 10초마다 캔들을 조회하고 주문 성공 뒤 1회 추가 조회합니다. 데이터 변경 알림을 더 빠르게 제공하려면 Supabase Realtime Broadcast 등으로 `marketId`, `revision`만 알린 뒤 프론트가 위 RPC를 재조회하는 방식을 권장합니다. 주문 원본이나 민감한 지갑 데이터는 Broadcast에 넣지 않습니다.

## 5. 서버에서 반드시 처리할 동시성

프론트의 버튼 비활성화는 같은 탭의 중복 클릭만 막습니다. 다음은 서버에서 보장해야 합니다.

- 여러 탭·여러 기기에서 같은 사용자가 동시에 투자해도 잔액이 음수가 되지 않음
- 같은 `idempotency_key` 재시도는 주문·지갑 차감을 한 번만 수행
- 서로 다른 사용자의 동시 주문에서도 `current_price`, 캔들, `market.revision`이 순서대로 확정
- 장 마감과 주문이 동시에 발생할 때 `close_at` 서버 시각을 기준으로 한쪽만 확정
- `place_order` 커밋 후 즉시 `get_my_position`, `get_market_candles`가 해당 주문 또는 더 최신 상태를 읽음

Supabase/Postgres에서는 관련 market, wallet, position 행을 트랜잭션 안에서 잠그고 처리해 주세요. RLS만으로 잔액 차감/가격 갱신의 원자성을 보장할 수는 없습니다.

## 6. 확인 시나리오

1. 사용자 A가 3,000 크레딧을 첫 투자하고 즉시 `get_my_position`을 여러 번 호출해도 `position`이 null 또는 0으로 돌아가지 않는지
2. 사용자 A가 추가 투자한 뒤 `totalInvestment`, `quantity`가 이전보다 작아지지 않는지
3. 사용자 B의 주문이 A의 포트폴리오를 바꾸지는 않지만, 시장 현재가와 캔들에는 반영되는지
4. 짧은 시간에 여러 주문이 발생해도 OHLC가 시간순과 가격 순서를 지키는지
5. 같은 응답을 재시도했을 때 idempotency key 기준으로 지갑과 주문이 중복 처리되지 않는지
6. `base_price`가 1000이 아닌 종목에서도 `initialPrice`와 변동률 기준이 올바른지

관련 기존 계약: [investment-settlement-api-contract.md](./investment-settlement-api-contract.md), [price-candles-api-contract.md](./price-candles-api-contract.md)
