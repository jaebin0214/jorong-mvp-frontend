# 투자·포지션·정산 API 계약

프론트엔드는 API 주소가 설정되면 아래 API만 최종값으로 사용합니다. 브라우저의 `FinancialMath` 계산은 추가 투자 수량 미리보기와 API 미연결 시연 전용입니다.

```html
<script>window.JORONG_API_BASE_URL = 'https://api.example.com';</script>
```

모든 요청은 인증이 필요합니다. 금액은 **정수 KRW**, 가격·수량·손익은 JSON 숫자가 아닌 **문자열**로 반환해 정밀도를 보존합니다.

## 공통 오류 형식

```json
{ "code": "POSITION_LOCKED", "message": "한 번 선택한 의견은 장 종료까지 변경할 수 없습니다." }
```

| 코드 | HTTP | 의미 |
| --- | --- | --- |
| `INVALID_AMOUNT` | 422 | 0 이하, 정수가 아닌 투자금 |
| `INSUFFICIENT_BALANCE` | 409 | 사용 가능 잔액 부족 |
| `MARKET_NOT_FOUND` | 404 | 존재하지 않는 시장 |
| `MARKET_NOT_OPEN` | 409 | 아직 열리지 않은 시장 |
| `MARKET_CLOSED` | 409 | 이미 종료된 시장 |
| `POSITION_LOCKED` | 409 | 반대 의견 추가 투자 |
| `INVALID_EXECUTION_PRICE` | 409 | 0 이하 또는 유효하지 않은 현재 가격 |
| `DUPLICATE_ORDER` | 409 | 같은 `idempotencyKey`의 중복 주문 |
| `SETTLEMENT_PENDING` | 202 | 서버 정산 배치가 아직 끝나지 않음 |

## 1. 서버 시계

`GET /markets/current/clock`

```json
{
  "marketSessionId": "round-001-hoon",
  "status": "OPEN",
  "openAt": "2026-08-14T13:00:00+09:00",
  "closeAt": "2026-08-14T19:00:00+09:00",
  "nextOpenAt": "2026-08-15T13:00:00+09:00",
  "serverNow": "2026-08-14T14:22:18+09:00"
}
```

`status`는 `SCHEDULED | OPEN | CLOSED | SETTLED` 중 하나입니다. 프론트는 `OPEN`일 때만 주문을 보이게 하지만, 서버는 주문 트랜잭션 안에서 다시 검증해야 합니다.

## 2. 주문 생성

`POST /markets/{marketId}/orders`

헤더:

```http
Idempotency-Key: 8d35d8c0-2e9e-4b5e-9277-1b5e1fd46679
```

본문:

```json
{
  "marketId": "round-001-hoon",
  "targetId": "hoon",
  "side": "MOCK",
  "investmentAmount": 3000,
  "idempotencyKey": "8d35d8c0-2e9e-4b5e-9277-1b5e1fd46679"
}
```

서버 처리 순서:

1. `markets`, 사용자 지갑, 해당 `(userId, marketId)` 포지션을 잠급니다.
2. 서버 `now`, 시장 상태, 가격, 잔액, idempotency key를 검증합니다.
3. 기존 포지션이 있으면 `side`가 같은지 확인합니다. 다르면 `POSITION_LOCKED`를 반환합니다.
4. `addedQuantity = investmentAmount / executionPrice`로 수량을 `NUMERIC(28,12)` 정밀도로 계산합니다.
5. 지갑 차감, 주문 생성, 포지션 가중평균 갱신, 현재가/캔들 갱신, 지갑 원장 기록을 **한 DB 트랜잭션**으로 처리합니다.

성공 응답:

```json
{
  "order": {
    "id": "order_123",
    "marketId": "round-001-hoon",
    "side": "MOCK",
    "investmentAmount": "3000",
    "executionPrice": "930.00000000",
    "addedQuantity": "3.225806451613",
    "idempotencyKey": "8d35d8c0-2e9e-4b5e-9277-1b5e1fd46679",
    "createdAt": "2026-08-14T05:30:00.000Z"
  },
  "position": {
    "id": "position_123",
    "side": "MOCK",
    "totalInvestment": "3000",
    "quantity": "3.225806451613",
    "averagePrice": "930.00000000",
    "status": "OPEN"
  },
  "positionMetrics": {
    "currentPrice": "900.00000000",
    "unrealizedPnl": "96.77419355",
    "pnlRate": "3.22580645",
    "estimatedSettlementAmount": "3096.77419355"
  },
  "wallet": { "points": 7000 },
  "target": { "id": "hoon", "previousValue": 930, "value": 900, "valueChange": -30 },
  "marketSummary": { "supportRatio": 38, "mockRatio": 62, "totalVolume": "1248000", "participants": 312 }
}
```

## 3. 현재 포지션 복원

`GET /markets/{marketId}/me/position`

새로고침과 재로그인 뒤 호출합니다. 응답은 주문 생성 성공 응답의 `position`, `positionMetrics`, `wallet`, `target`, `market`, `marketSummary`, `orders` 필드를 같은 형태로 포함합니다. 포지션이 없다면 `position: null`, `positionMetrics: null`을 반환합니다.

## 4. 장 종료와 정산 조회

정산은 클라이언트 호출이 아니라 서버 스케줄러 또는 종료를 감지한 트랜잭션에서 수행합니다.

1. `status`를 `CLOSED`로 전환하고 `closePrice`를 한 번만 저장합니다.
2. 미정산 포지션별 `realizedPnl`과 `settlementAmount`를 계산합니다.
3. `settlements` INSERT, 지갑 지급, `wallet_transactions` INSERT, 포지션 `SETTLED` 전환을 하나의 트랜잭션으로 처리합니다.
4. `UNIQUE(user_id, market_id)` 충돌은 이미 지급된 정산으로 처리해 재시도해도 중복 지급하지 않습니다.

`GET /markets/{marketId}/me/settlement`

```json
{
  "market": {
    "id": "round-001-hoon",
    "status": "SETTLED",
    "closePrice": "860.00000000",
    "nextOpenAt": "2026-08-15T13:00:00+09:00"
  },
  "position": {
    "id": "position_123",
    "side": "MOCK",
    "totalInvestment": "3000",
    "quantity": "3.225806451613",
    "averagePrice": "930.00000000",
    "status": "SETTLED"
  },
  "settlement": {
    "id": "settlement_123",
    "closePrice": "860.00000000",
    "realizedPnl": "225.80645161",
    "pnlRate": "7.52688172",
    "settlementAmount": "3226",
    "balanceAfterSettlement": "100226",
    "settledAt": "2026-08-14T10:00:00.000Z"
  },
  "wallet": { "points": 100226 },
  "marketSummary": { "supportRatio": 38, "mockRatio": 62, "totalVolume": "1248000", "participants": 312 }
}
```

정산 지급액은 `ROUND_HALF_UP`으로 KRW 정수 반올림한 뒤 지갑에 기록합니다.

## 5. 개인 사이클 리포트

`GET /me/cycle-reports`

로그인한 사용자가 참여했고 정산이 완료된 시장을 최신 정산일 순으로 반환합니다. 프론트엔드는 이 응답을 사이클 리포트 화면에서 시장별 정산 결과 카드로 표시합니다.

```json
{
  "reports": [
    {
      "id": "settlement_123",
      "market": {
        "id": "round-001-hoon",
        "status": "SETTLED",
        "closeAt": "2026-08-14T10:00:00.000Z",
        "closePrice": "860.00000000"
      },
      "subject": {
        "id": "hoon",
        "name": "훈이",
        "imageUrl": "https://cdn.example.com/markets/hoon.png"
      },
      "position": {
        "id": "position_123",
        "side": "MOCK",
        "totalInvestment": "3000",
        "quantity": "3.225806451613",
        "averagePrice": "930.00000000",
        "status": "SETTLED"
      },
      "settlement": {
        "id": "settlement_123",
        "closePrice": "860.00000000",
        "realizedPnl": "225.80645161",
        "pnlRate": "7.52688172",
        "settlementAmount": "3226",
        "balanceAfterSettlement": "100226",
        "settledAt": "2026-08-14T10:00:00.000Z"
      },
      "marketSummary": {
        "supportRatio": 38,
        "mockRatio": 62,
        "totalVolume": "1248000",
        "participants": 312
      },
      "myComments": [
        {
          "id": "comment_001",
          "parentCommentId": null,
          "content": "오늘도 자신감은 상한가",
          "status": "PUBLIC",
          "createdAt": "2026-08-14T05:20:00.000Z"
        }
      }
    }
  ]
}
```

- 인증 필요: 예
- 서버는 `userId`를 세션에서 식별하고, 다른 사용자의 정산 결과를 포함하면 안 됩니다.
- `subject.imageUrl`은 공개적으로 접근 가능한 Storage URL을 반환합니다. 로컬 시연 모드에서는 브라우저에 저장된 이미지 경로를 사용합니다.
- `myComments`에는 해당 시장에서 로그인 사용자가 작성한 원댓글·답글만 포함합니다. 삭제된 댓글은 `status: "DELETED"`로 남겨 개인 이력과 운영 기록을 일관되게 유지합니다.
- 현재 API 주소가 설정되지 않은 정적 시연에서는 장 종료 이벤트의 정산 스냅샷을 사용자별 `localStorage`에 보관해 리포트를 구성합니다.

## 계산과 반올림 기준

```text
addedQuantity = investmentAmount / executionPrice
newTotalInvestment = oldTotalInvestment + investmentAmount
newQuantity = oldQuantity + addedQuantity
newAveragePrice = newTotalInvestment / newQuantity

direction(SUPPORT) = +1
direction(MOCK) = -1
unrealizedPnl = direction × (currentPrice - averagePrice) × quantity
pnlRate = unrealizedPnl / totalInvestment × 100
estimatedSettlementAmount = max(0, totalInvestment + unrealizedPnl)
```

- DB 내부: `price NUMERIC(20,8)`, `quantity NUMERIC(28,12)`, `pnl NUMERIC(28,8)`
- 화면: 수량 4자리, 평균 단가·수익률 2자리, KRW 0자리
- 중간 계산에서는 반올림하지 않고, 화면 표시와 정산 지급액에서만 `ROUND_HALF_UP` 합니다.
