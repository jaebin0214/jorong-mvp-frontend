# 투자 API 연결 계약

> 차트 집계를 위해 모든 투자 생성 요청에는 현재 거래 회차를 식별하는 `marketSessionId`를 포함합니다. 캔들 조회·집계 상세는 [price-candles-api-contract.md](./price-candles-api-contract.md)를 따릅니다.

프론트엔드는 `window.JORONG_API_BASE_URL`이 비어 있을 때 로컬 모의 투자 서비스를 사용합니다. 백엔드 연결 시 앱 시작 전에 API 기본 주소를 설정하면 자동으로 실제 요청으로 전환됩니다.

```html
<script>window.JORONG_API_BASE_URL = 'https://api.example.com';</script>
```

## 요청

`POST /investments`

```json
{
  "targetId": "hoon",
  "side": "SUPPORT",
  "amount": 5000
}
```

- `targetId`: 투자 항목 ID
- `side`: `SUPPORT`(옹호) 또는 `ROAST`(조롱)
- `amount`: 10 KRW 단위의 양의 정수

## 성공 응답

```json
{
  "investment": {
    "id": "inv_123",
    "targetId": "hoon",
    "side": "SUPPORT",
    "amount": 5000,
    "createdAt": "2026-08-11T10:00:00.000Z"
  },
  "wallet": {
    "points": 5000
  },
  "target": {
    "id": "hoon",
    "previousValue": 1000,
    "value": 1050,
    "valueChange": 50
  }
}
```

- `wallet.points`: 투자 차감 후 남은 포인트
- `target.value`: 반영 후 투자 항목 가치
- `target.valueChange`: 이번 투자로 변한 가치. 옹호는 양수, 조롱은 음수입니다.

## 오류 응답

HTTP `400` 또는 `422`에 아래 형태를 권장합니다.

```json
{ "message": "보유 포인트가 부족합니다." }
```
