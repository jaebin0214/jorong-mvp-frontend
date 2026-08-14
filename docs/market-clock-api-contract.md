# 서버 관리 거래 타이머 API 계약

모든 사용자가 같은 시간을 보려면 브라우저 저장소가 아니라 서버가 거래 회차의 종료 시각과 현재 시각을 제공해야 합니다. 프론트엔드는 API 연결 후 처음 한 번과 이후 30초마다 이 API를 호출해 기기 시계 오차를 보정합니다.

## API

```http
GET /markets/current/clock
Accept: application/json
Cache-Control: no-store
```

## 성공 응답

```json
{
  "marketSessionId": "round-2026-08-12-01",
  "status": "OPEN",
  "startsAt": "2026-08-12T14:00:00+09:00",
  "endsAt": "2026-08-12T20:00:00+09:00",
  "nextOpenAt": "2026-08-13T14:00:00+09:00",
  "serverNow": "2026-08-12T15:42:18+09:00"
}
```

- `marketSessionId`: 현재 거래 회차 ID입니다.
- `status`: `SCHEDULED`, `OPEN`, `CLOSED`, `SETTLED` 중 하나입니다. `CLOSED` 또는 `SETTLED`이면 종료 화면으로 전환합니다.
- `endsAt`: 서버가 계산한 절대 종료 시각입니다. 반드시 시간대가 포함된 ISO 8601 문자열을 사용합니다.
- `serverNow`: 응답을 생성한 서버의 현재 시각입니다. 프론트엔드는 이 값과 기기 시각의 차이를 계산합니다.
- `nextOpenAt`: 종료 화면에서 다음 장까지 남은 시간을 표시하는 절대 시각입니다.

`endsAt` 대신 `startsAt`과 `durationHours`를 함께 반환해도 프론트엔드가 종료 시각을 계산할 수 있지만, 서버가 직접 계산한 `endsAt` 반환을 권장합니다.

## 프론트엔드 연결

배포 환경에서 앱 스크립트보다 먼저 API 주소를 설정합니다.

```html
<script>
  window.JORONG_API_BASE_URL = 'https://api.example.com';
  // 필요하면 기본 경로 대신 별도 타이머 주소를 지정합니다.
  // window.JORONG_MARKET_CLOCK_URL = 'https://api.example.com/markets/current/clock';
</script>
```

`JORONG_API_BASE_URL`가 설정되지 않은 현재 정적 MVP는 데모 목적의 로컬 타이머를 계속 사용합니다. 실제 운영에서는 이 값을 설정하고 API가 CORS 정책상 프론트엔드 도메인을 허용해야 합니다.

## 서버 검증

투자와 댓글 생성 API는 이 시계와 별개로, 데이터베이스 트랜잭션 안에서 서버 시간 기준 `status`와 `endsAt`을 다시 검사해야 합니다. 클라이언트 타이머는 화면 표시 용도이며 최종 권한 판정 수단이 아닙니다.
