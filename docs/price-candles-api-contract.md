# 가격 캔들 API 계약서

차트는 투자 기록을 프론트엔드에서 임의로 계산하지 않고, 백엔드가 특정 거래 회차에 참여한 **모든 사용자**의 저장된 투자 기록을 시간 단위로 집계한 결과를 받습니다.

## 요청

`GET /markets/{marketSessionId}/candles?targetId={targetId}&intervalSeconds=60`

예시:

```http
GET /markets/round-001-hoon/candles?targetId=hoon&intervalSeconds=60
```

- `marketSessionId`: 거래 회차 ID. `market-config.js`의 `session.id`와 동일합니다.
- `targetId`: 투자 종목 ID입니다.
- `intervalSeconds`: 캔들 하나의 집계 단위입니다. MVP 기본값은 `60`초입니다.

## 성공 응답

```json
{
  "marketSessionId": "round-001-hoon",
  "targetId": "hoon",
  "initialPrice": 1000,
  "candles": [
    {
      "startedAt": "2026-08-12T09:00:00.000+09:00",
      "endedAt": "2026-08-12T09:01:00.000+09:00",
      "open": 1000,
      "high": 1050,
      "low": 1000,
      "close": 1050,
      "volume": 5000
    }
  ]
}
```

- `initialPrice`: 운영자가 종목 개설 시 설정한 최초 가격입니다. 프론트의 차트 중앙 기준선은 이 값으로 표시합니다.
- `open`, `high`, `low`, `close`: 해당 시간 구간에서 모든 사용자 주문을 반영한 가격입니다.
- `volume`: 해당 구간에 체결된 총 투자 금액입니다.
- `startedAt`, `endedAt`: ISO 8601 시각 문자열입니다.

## 백엔드 집계 기준

1. `investments` 테이블을 `marketSessionId`, `targetId`, 생성 시각으로 조회합니다. 사용자 ID로 제한하지 않습니다.
2. `intervalSeconds` 단위로 묶어 시간순으로 집계합니다.
3. 각 구간의 첫 가격을 `open`, 최고·최저 가격을 `high`·`low`, 마지막 가격을 `close`로 저장하거나 계산합니다.
4. 투자 기록이 없는 구간은 필요하다면 이전 `close` 가격으로 빈 캔들을 생성합니다.
5. 현재 진행 중인 회차에서는 어느 사용자의 새 투자 처리 후에도 이 API가 최신 값을 반환하도록 합니다.
6. 프론트는 API 모드에서 이 응답을 10초 간격으로 다시 조회합니다. 실시간 전송을 추가할 경우 WebSocket/Supabase Realtime으로 같은 데이터를 푸시해도 됩니다.

## 투자 API 변경

투자 생성 요청에는 아래 필드를 함께 받습니다.

```json
{
  "marketSessionId": "round-001-hoon",
  "targetId": "hoon",
  "side": "SUPPORT",
  "amount": 5000
}
```

서버는 로그인한 사용자와 회차 상태를 검증한 뒤 투자·가격 이력을 트랜잭션으로 저장해야 합니다. 종료된 회차에는 새 투자를 허용하지 않습니다.
