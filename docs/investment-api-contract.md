# 투자 API 연결 계약

투자·가중평균 포지션·정산의 최신 API 계약은 [investment-settlement-api-contract.md](./investment-settlement-api-contract.md)를 기준으로 사용합니다.

현재 프론트엔드의 요청 경로는 다음과 같습니다.

```http
POST /markets/{marketId}/orders
GET  /markets/{marketId}/me/position
GET  /markets/{marketId}/me/settlement
```

## 주문 요청 핵심값

```json
{
  "marketId": "round-001-hoon",
  "targetId": "hoon",
  "side": "SUPPORT",
  "investmentAmount": 5000,
  "idempotencyKey": "client-generated-uuid"
}
```

- `side`: `SUPPORT` 또는 `MOCK`입니다. 이전 MVP의 `ROAST` 값은 더 이상 새 API에 보내지 않습니다.
- `investmentAmount`: 1 KRW 이상 정수입니다.
- `idempotencyKey`: 한 번의 버튼 클릭마다 클라이언트가 새로 생성합니다. 서버는 `(userId, marketId, idempotencyKey)`를 UNIQUE로 검증합니다.

성공 응답에는 `order`, `position`, `positionMetrics`, `wallet`, `target`, `marketSummary`를 포함해야 합니다. 프론트는 이 응답만으로 내 투자 현황 카드와 그래프·잔액을 동기화합니다.
