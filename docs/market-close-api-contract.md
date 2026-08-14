# 거래 종료 처리 계약

클라이언트는 `marketSessionId`의 `startsAt + durationHours`가 되면 거래 영역을 종료 상태로 표시합니다. 그러나 실제 투자 차단과 가격 보존은 반드시 서버에서 최종 처리해야 합니다.

## 투자 생성 차단

종료된 회차에 대한 `POST /markets/{marketId}/orders` 요청은 아래처럼 거절합니다.

```http
POST /markets/{marketId}/orders → 409 Conflict
```

```json
{
  "code": "MARKET_CLOSED",
  "message": "거래가 종료되었습니다."
}
```

서버는 거절된 요청에 대해 투자 내역, 지갑 포인트, 종목 가격 및 캔들 데이터를 변경해서는 안 됩니다.

## 종료 시각 기준

`marketSessionId`에 저장된 회차 설정을 기준으로 계산합니다.

```text
marketEndAt = session.startsAt + session.durationHours
```

- `startsAt`은 시간대가 포함된 ISO 8601 시각으로 보관합니다.
- 서버 시간 기준으로 `now >= marketEndAt`이면 거래 종료입니다.
- 여러 사용자가 동시에 요청해도 데이터베이스 트랜잭션 안에서 종료 여부를 다시 검증합니다.
