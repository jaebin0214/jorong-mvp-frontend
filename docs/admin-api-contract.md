# 조롱 거래소 관리자 API 계약서

관리자 화면은 `admin.html`과 `scripts/admin-service.js`로 분리되어 있습니다. 기본값은 `jorong_admin_demo_v1` 로컬 시연 모드이며, 실제 API는 아래 두 값을 모두 설정한 뒤에만 사용합니다.

```html
<script>
  window.JORONG_API_BASE_URL = 'https://api.example.com';
  window.JORONG_ADMIN_API_ENABLED = true;
</script>
```

`JORONG_ADMIN_API_ENABLED`를 별도로 둔 이유는 기존 사용자 API 주소만 설정된 배포에서도 아직 구현되지 않은 `/admin/*` 요청으로 사용자 화면이나 관리자 화면이 깨지지 않게 하기 위함입니다.

## 공통 규칙

- 모든 `/admin/*` 요청은 서버의 관리자 인증·권한 검사가 필수입니다.
- 권한 없음은 `401 ADMIN_AUTH_REQUIRED`, `403 ADMIN_FORBIDDEN`으로 응답합니다.
- 오류 형식은 `{ "code": "ERROR_CODE", "message": "사용자 안내 문구" }`입니다.
- 거래 시작·종료·정산·크레딧 조정·댓글 삭제·사용자 제한 요청은 `Idempotency-Key`를 요구하고 감사 로그를 트랜잭션으로 기록합니다.
- 실제 예약 자동 시작·자동 정산·시장 상태 최종 판정은 클라이언트가 아니라 서버 스케줄러와 DB 트랜잭션이 담당합니다.

### 예약·마감 자동 처리

서버 스케줄러는 `autoStart = true`인 `SCHEDULED` 시장의 `startAt` 도달 시 `LIVE`로 전환해야 합니다. `LIVE` 시장의 `endAt` 도달 시에는 신규 주문·댓글을 먼저 차단하고 `CLOSED → SETTLED` 전환, 마감가 확정, 모든 미정산 포지션 정산과 지갑 반영을 **하나의 멱등 트랜잭션**으로 처리해야 합니다. 같은 작업이 여러 번 실행되어도 중복 정산되지 않아야 합니다.

로컬 시연은 열려 있는 관리자 또는 거래소 탭이 약 1.5초 주기로 같은 상태 전환을 흉내 냅니다. 실제 Supabase 운영 환경에서는 브라우저가 닫혀 있어도 동작하도록 pg_cron·Edge Function 또는 서버 워커가 이 역할을 수행해야 하며, 사용자 화면은 기존 `get_market_runtime` 폴링으로 갱신된 상태를 받습니다.

| 오류 코드 | HTTP | 의미 |
| --- | --- | --- |
| `ADMIN_AUTH_REQUIRED` | 401 | 관리자 로그인 세션 없음 |
| `ADMIN_FORBIDDEN` | 403 | 관리자 역할 없음 |
| `MARKET_REQUIRED_FIELDS` | 422 | 종목 필수 입력 누락 |
| `INVALID_MARKET_TIME` | 422 | 시작/종료 시간 오류 |
| `MARKET_SCHEDULE_CONFLICT` | 409 | 예약·거래 중 시간 겹침 |
| `LIVE_MARKET_EXISTS` | 409 | 이미 다른 LIVE 시장 존재 |
| `MARKET_EDIT_LOCKED` | 409 | 시작된 시장의 일반 편집 시도 |
| `MARKET_DELETE_LOCKED` | 409 | 거래가 시작됐거나 정산 이력이 있는 종목의 완전 삭제 시도 |
| `INVALID_MARKET_TRANSITION` | 409 | 허용되지 않은 상태 전환 |
| `MODERATION_REASON_REQUIRED` | 422 | 댓글 처리 사유 누락 |
| `CREDIT_REASON_REQUIRED` | 422 | 크레딧 조정 사유 누락 |

## 상태 값

시장 상태는 아래 전환만 허용합니다. `ARCHIVED`는 정산이 끝난 시장의 이력 보관 상태입니다.

```text
DRAFT → SCHEDULED → LIVE → CLOSED → SETTLED → ARCHIVED
          └──────→ DRAFT
```

`SCHEDULED`, `LIVE` 시장의 운영 시간이 겹치면 `MARKET_SCHEDULE_CONFLICT`를 반환합니다. LIVE 시장은 하나만 허용하며 충돌 시 `LIVE_MARKET_EXISTS`를 반환합니다.

## 대시보드

`GET /admin/dashboard` — 관리자 권한 필요

```json
{
  "liveMarket": { "id": "market_007", "status": "LIVE", "participantCount": 128, "tradeCount": 842, "commentCount": 36 },
  "nextMarkets": [],
  "participationTrend": [38, 54, 68, 81, 63, 92]
}
```

## 종목 관리

| 요청 | 용도 | 감사 로그 |
| --- | --- | --- |
| `GET /admin/markets` | 상태·날짜별 종목 목록 | 없음 |
| `POST /admin/markets` | 초안 종목 생성 | 생성 |
| `GET /admin/markets/{marketId}` | 종목 상세·예약 검증 정보 | 없음 |
| `PATCH /admin/markets/{marketId}` | 초안 정보 수정 | 수정 |
| `POST /admin/markets/{marketId}/schedule` | 예약 전환 | 예약 |
| `POST /admin/markets/{marketId}/start` | 거래 시작 | 시작 |
| `POST /admin/markets/{marketId}/close` | 거래 종료 | 종료 |
| `POST /admin/markets/{marketId}/settle` | 정산 완료 | 정산 |
| `POST /admin/markets/{marketId}/archive` | 정산 완료 시장 보관 | 보관 |
| `DELETE /admin/markets/{marketId}` | 거래 전 종목 완전 삭제 | 삭제 |
| `POST /admin/markets/{marketId}/duplicate` | 기존 종목을 새 `DRAFT`로 복제 | 생성 |

생성·수정 본문:

```json
{
  "subjectName": "훈이",
  "shortIntroduction": "참을 수 없는 자신감",
  "description": "상세 설명",
  "imagePath": "https://cdn.example.com/market/hoon.png",
  "operationDate": "2026-08-15",
  "startAt": "2026-08-15T13:00:00+09:00",
  "endAt": "2026-08-15T19:00:00+09:00",
  "basePrice": 1000,
  "minTradeUnit": 10,
  "settlementMethod": "자동 정산",
  "autoStart": true,
  "autoSettle": true,
  "commentsPublic": true
}
```

`subjectName`, `imagePath`, `startAt`, `endAt`는 필수입니다. 거래가 시작된 시장의 종목명·운영 시간·기준 가격 변경은 `MARKET_EDIT_LOCKED`로 거절합니다.

### 종목 완전 삭제

관리자 화면의 **삭제** 버튼은 거래가 시작되지 않은 `DRAFT`, `SCHEDULED` 종목을 목록과 DB에서 완전히 삭제합니다. 현재 Supabase 어댑터는 `admin_delete_market(p_market_id)` RPC를 호출합니다. 서버는 이 RPC(또는 `DELETE /admin/markets/{marketId}`)에서 관리자 권한과 상태를 잠근 뒤, 종목·연결된 거래 전 댓글·이미지 참조를 하나의 트랜잭션으로 삭제해야 합니다.

`LIVE`, `CLOSED`, `SETTLED` 또는 실제 투자·정산 이력이 있는 종목은 `409 MARKET_DELETE_LOCKED`로 거절해야 합니다. 이력 보관이 필요한 정산 완료 종목은 기존 `POST /admin/markets/{marketId}/archive`로 `ARCHIVED` 전환만 허용합니다.

### 종목 이미지 업로드

`POST /admin/market-images` — 관리자 권한 필요

`multipart/form-data`의 `file` 필드로 이미지를 받습니다. 서버는 파일 타입·용량을 검사한 뒤 Supabase Storage 등의 비공개 버킷에 저장하고, 사용자 화면에서 사용할 수 있는 공개 URL 또는 유효기간이 충분한 서명 URL을 반환합니다.

```json
{ "imageUrl": "https://<project>.supabase.co/storage/v1/object/public/market-images/market_001.png" }
```

프론트는 이 URL만 `imagePath` 필드에 보관합니다. Data URL과 Storage service-role 키를 브라우저에서 직접 저장·노출하면 안 됩니다.

## 댓글 관리

| 요청 | 용도 | 감사 로그 |
| --- | --- | --- |
| `GET /admin/comments` | 종목·상태·검색 댓글 목록 | 없음 |
| `POST /admin/comments` | 운영진/공지 댓글 작성 | 작성 |
| `PATCH /admin/comments/{commentId}/moderation` | 숨김·해제·소프트 삭제 | 처리 |

댓글 응답은 `authorType: USER | ADMIN`, `operatorName`, `isNotice`, `pinned`, `status: PUBLIC | HIDDEN | FLAGGED | BANNED | DELETED`를 포함합니다. 운영진 댓글은 `authorName: "조롱 거래소 운영진"` 및 `authorType: "ADMIN"`으로 일반 사용자와 구분해야 합니다.

처리 본문:

```json
{ "action": "HIDE", "reason": "신고 내용 검토", "operatorId": "admin_1" }
```

`action`은 `HIDE | UNHIDE | DELETE`이며 사유는 필수입니다. DELETE는 감사·분석용 원문을 보존하는 소프트 삭제입니다.

## 사용자·지갑·제한

| 요청 | 용도 | 감사 로그 |
| --- | --- | --- |
| `GET /admin/users` | 사용자 상태·크레딧 목록 | 없음 |
| `GET /admin/users/{userId}` | 사용자 상세·댓글·거래 요약 | 없음 |
| `POST /admin/users/{userId}/wallet-adjustments` | 크레딧 조정 | 조정 |
| `PATCH /admin/users/{userId}/restrictions` | 댓글 작성/이용 제한 | 제한 |

크레딧 조정 본문:

```json
{ "amount": -400, "reason": "운영 보정", "idempotencyKey": "uuid" }
```

서버는 지갑 행 잠금, 변경 전·후 잔액, 조정값, 사유, 처리 관리자, 시각을 하나의 트랜잭션으로 저장해야 합니다. 결과 응답에는 `balanceBefore`, `balanceAfter`, `walletTransactionId`를 포함합니다.

## 감사 로그

`GET /admin/audit-logs`는 `createdAt`, `category`, `action`, `target`, `detail`, `operator`를 반환합니다. 운영상 중요한 변경은 어떤 API 경로를 호출하더라도 서버가 직접 감사 로그를 생성해야 하며, 프론트엔드에서만 기록한 값은 최종 근거로 사용할 수 없습니다.

## 서버 최종 책임 항목

- 관리자 세션, 역할, 대상 시장·댓글·사용자 접근 권한 검사
- 시간 충돌·동시 LIVE 시장·종료 후 주문/댓글 차단
- 거래 종료와 정산의 원자성 및 중복 실행 방지
- 크레딧 원장·잔액 트랜잭션
- 댓글 소프트 삭제, 사용자 제한의 영속화
- 이미지 바이러스 검사·저장소 업로드·CDN URL 발급
