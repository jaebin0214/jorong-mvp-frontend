# 시장 런타임 API 계약

정적 프론트엔드가 서버에서 현재 시장을 구성하기 위한 API입니다. `window.JORONG_API_BASE_URL`이 설정되면 [market-runtime-bootstrap.js](../scripts/market-runtime-bootstrap.js)가 호출합니다.

## `GET /markets/current`

- 인증: 불필요 (시장 정보는 공개)
- 캐시: `Cache-Control: no-store` 권장
- 서버 최종 책임: 현재 OPEN 시장 선택, 종료 시장 유지, 다음 예약 시간 계산

### 거래 중 또는 종료 장이 있는 경우

```json
{
  "marketAvailable": true,
  "displayMarket": {
    "id": "market_001",
    "status": "OPEN",
    "openAt": "2026-08-17T13:00:00+09:00",
    "closeAt": "2026-08-17T19:00:00+09:00",
    "nextOpenAt": "2026-08-18T13:00:00+09:00",
    "subject": {
      "id": "subject_001",
      "name": "훈이",
      "imageUrl": "https://<supabase-project>.supabase.co/storage/v1/object/public/market-images/hoon.png",
      "description": "종목 설명",
      "initialPrice": 1000
    }
  },
  "nextMarket": { "id": "market_002", "openAt": "2026-08-18T13:00:00+09:00" },
  "serverNow": "2026-08-17T14:00:00+09:00"
}
```

`displayMarket.status`는 `OPEN | CLOSED | SETTLED | ARCHIVED`를 사용합니다. `CLOSED` 또는 `SETTLED` 상태에서는 `displayMarket`을 유지해야 프론트가 정산 화면과 다음 장 타이머를 표시할 수 있습니다.

### 아직 운영 이력이 없는 경우

```json
{ "marketAvailable": false, "nextMarket": null }
```

## Supabase 구현 메모

- `markets` 테이블에서 `OPEN` 시장을 우선 조회합니다.
- OPEN 시장이 없으면 가장 최근 `CLOSED`/`SETTLED` 시장을 `displayMarket`으로 조회합니다.
- 가장 빠른 `SCHEDULED` 시장을 `nextMarket`과 `displayMarket.nextOpenAt`으로 반환합니다.
- 이미지에는 Supabase Storage의 공개 URL 또는 서명 URL을 반환합니다.
- 프론트는 30초마다 이 API를 확인하지만, 실제 시장 전환·정산은 서버 스케줄러 또는 DB 함수가 책임집니다.
