# 조롱 거래소 백엔드 연동 명세

이 문서는 현재 프론트엔드와 백엔드가 공유하는 최소 계약입니다. 프론트엔드에서는 `scripts/api-config.js`의 `window.JORONG_API_BASE_URL`에 API 주소를 설정하면 로컬 시연 데이터 대신 아래 API를 호출합니다.

```js
window.JORONG_API_BASE_URL = 'https://api.example.com';
```

인증은 **HttpOnly Secure 세션 쿠키**를 우선 권장합니다. Bearer 토큰 방식도 지원하며, 로그인 응답의 `accessToken`은 브라우저 세션 동안만 보관됩니다. 모든 오류 응답은 아래 형식으로 반환합니다.

```json
{ "message": "사용자에게 보여줄 오류 메시지" }
```

## 1. 저장 모델

| 테이블 | 필수 필드 | 용도 / 제약 |
| --- | --- | --- |
| `users` | `id`, `nickname`, `password_hash`, `points`, `created_at` | `nickname`은 UNIQUE. 비밀번호 원문은 저장하지 않고 Argon2id 또는 bcrypt 해시만 저장합니다. `points`는 현재 잔액 캐시입니다. |
| `point_ledger` | `id`, `user_id`, `market_session_id`, `type`, `amount`, `balance_after`, `investment_id`, `created_at` | 투자 차감·정산 보상 같은 포인트 변동을 불변 로그로 기록합니다. 잔액 검증/감사 기준입니다. |
| `market_sessions` | `id`, `target_id`, `target_name`, `target_image_url`, `initial_price`, `starts_at`, `ends_at`, `status` | 운영자가 여는 시장 라운드. `status`: `SCHEDULED`, `OPEN`, `CLOSED`, `SETTLED`. |
| `investment_orders` | `id`, `user_id`, `market_id`, `side`, `investment_amount`, `execution_price`, `added_quantity`, `idempotency_key`, `created_at` | 모든 주문 로그. `side`: `SUPPORT` 또는 `MOCK`. |
| `positions` | `id`, `user_id`, `market_id`, `side`, `total_investment`, `quantity`, `average_price`, `status` | 한 사용자·시장당 하나의 가중평균 포지션. `UNIQUE(user_id, market_id)`. |
| `price_candles` | `market_session_id`, `target_id`, `interval_seconds`, `started_at`, `open`, `high`, `low`, `close`, `volume` | 모든 투자를 집계한 OHLC 캔들. `(market_session_id, target_id, interval_seconds, started_at)` UNIQUE. |
| `comments` | `id`, `market_session_id`, `target_id`, `parent_comment_id`, `user_id`, `content`, `created_at`, `deleted_at` | `parent_comment_id`가 `NULL`이면 댓글, 값이 있으면 답글. 삭제는 soft delete를 권장합니다. |
| `comment_hypes` | `id`, `user_id`, `market_session_id`, `comment_id`, `created_at` | **`UNIQUE (user_id, market_session_id)`**로 한 사용자가 한 시장에서 오직 한 댓글/답글만 HYPE할 수 있게 합니다. |
| `settlements` | `id`, `user_id`, `market_session_id`, `investment_id`, `payout`, `status`, `claimed_at` | 종료 뒤 각 투자 정산 결과. 재정산 방지를 위해 `(user_id, investment_id)` UNIQUE. |

`users.points` 변경, `point_ledger` 기록, `investments` 생성, 가격 업데이트는 반드시 하나의 DB 트랜잭션으로 묶습니다. 잔액 행을 잠그거나 조건부 UPDATE를 사용해 동시 투자로 포인트가 음수가 되는 일을 막아야 합니다.

## 2. 회원가입·로그인·내 정보

### `POST /auth/signup`

```json
{ "nickname": "웃긴개미_241", "password": "user-entered-password" }
```

서버는 닉네임 중복을 검사하고, `users` 생성과 **초기 100,000 크레딧**의 `point_ledger` 기록을 같은 트랜잭션에서 처리합니다. 클라이언트가 초기 크레딧을 보내거나 정하지 않습니다.

### `POST /auth/login`

```json
{ "nickname": "웃긴개미_241", "password": "user-entered-password" }
```

### `GET /auth/me`

로그인과 회원가입의 성공 응답, 그리고 재접속 복원 응답은 아래 형태를 사용합니다.

```json
{
  "account": { "id": "user_123", "nickname": "웃긴개미_241", "createdAt": "2026-08-12T10:00:00.000Z" },
  "wallet": { "points": 100000 },
  "investmentLogs": [],
  "accessToken": "optional-token-if-not-using-cookie"
}
```

`GET /auth/me`은 현재 세션의 최신 `wallet.points`와 최근 투자 로그를 반환합니다. 프론트엔드는 앱 시작 시 이 API를 호출합니다.

### `POST /auth/logout`

세션 쿠키 또는 refresh token을 폐기합니다. `204 No Content`도 허용됩니다.

## 3. 시장 시계와 투자

### `GET /markets/current/clock`

모든 브라우저가 동일한 시간을 보도록 서버 시간이 포함되어야 합니다.

```json
{
  "marketSessionId": "round-001-hoon",
  "status": "OPEN",
  "endsAt": "2026-08-12T18:00:00.000Z",
  "serverNow": "2026-08-12T15:23:40.000Z"
}
```

### `GET /markets/current`

정적 프론트엔드가 새로고침 뒤에도 현재 종목·이미지·기준 가격과 다음 예약 시간을 구성하기 위한 공개 시장 런타임 API입니다. 거래 중이면 현재 `OPEN` 시장을, 장 종료 후 다음 장이 열리기 전이면 가장 최근 `CLOSED` 또는 `SETTLED` 시장을 `displayMarket`으로 반환해야 합니다.

```json
{
  "marketAvailable": true,
  "displayMarket": {
    "id": "round-001-hoon",
    "status": "SETTLED",
    "openAt": "2026-08-12T13:00:00+09:00",
    "closeAt": "2026-08-12T19:00:00+09:00",
    "nextOpenAt": "2026-08-13T13:00:00+09:00",
    "subject": {
      "id": "hoon",
      "name": "훈이",
      "imageUrl": "https://cdn.example.com/markets/hoon.png",
      "description": "종목 설명",
      "initialPrice": 1000
    }
  },
  "nextMarket": { "id": "round-002", "openAt": "2026-08-13T13:00:00+09:00" }
}
```

첫 장도 없을 때만 `{ "marketAvailable": false }`를 반환합니다. 프론트엔드는 `scripts/market-runtime-bootstrap.js`에서 이 값을 캐시한 뒤 시장 회차가 바뀌면 안전하게 다시 초기화합니다.

### `POST /markets/{marketId}/orders` (인증 필요)

```json
{
  "marketId": "round-001-hoon",
  "targetId": "hoon",
  "side": "SUPPORT",
  "investmentAmount": 5000,
  "idempotencyKey": "client-generated-uuid"
}
```

서버 검증 순서: 로그인 사용자 확인 → 시장이 `OPEN`인지 확인 → `investmentAmount`가 양의 정수인지 확인 → 잔액 확인 → 기존 포지션 방향 확인 → 주문/포지션/포인트 원장/현재 가격/캔들 기록. 반대 방향이면 `POSITION_LOCKED`를 반환합니다.

```json
{
  "investment": {
    "id": "inv_123",
    "userId": "user_123",
    "marketSessionId": "round-001-hoon",
    "targetId": "hoon",
    "side": "SUPPORT",
    "amount": 5000,
    "createdAt": "2026-08-12T15:24:00.000Z"
  },
  "wallet": { "points": 5000 },
  "target": { "id": "hoon", "previousValue": 1000, "value": 1050, "valueChange": 50 }
}
```

### `GET /me/investments?marketSessionId={id}` (인증 필요)

마이페이지와 재로그인 뒤 투자 로그 복원에 사용합니다.

```json
{
  "wallet": { "points": 5000 },
  "investments": [
    { "id": "inv_123", "targetName": "훈이", "side": "SUPPORT", "amount": 5000, "createdAt": "2026-08-12T15:24:00.000Z", "settlementStatus": "진행 중" }
  ]
}
```

### `GET /markets/{marketSessionId}/candles?targetId={targetId}&intervalSeconds=60`

모든 사용자의 투자 결과를 합산한 그래프 데이터입니다. 기본 10초 폴링으로 반영되며, 운영 환경에서는 WebSocket 또는 SSE로 `refresh` 이벤트를 보내면 더 빠르게 갱신할 수 있습니다.

```json
{
  "candles": [
    { "startedAt": "2026-08-12T12:00:00.000Z", "endedAt": "2026-08-12T12:01:00.000Z", "open": 1000, "high": 1050, "low": 1000, "close": 1050, "volume": 5000 }
  ]
}
```

## 4. 댓글·답글·HYPE

### `GET /markets/{marketSessionId}/comments?targetId={targetId}`

비로그인 사용자도 목록을 볼 수 있게 열어둘 수 있습니다. 로그인 사용자라면 인증 정보를 읽어 `canDelete`와 `isHypedByCurrentUser`를 정확하게 반환합니다.

```json
{
  "currentUserHypedCommentId": "comment_22",
  "bestCommentId": "comment_22",
  "comments": [
    {
      "id": "comment_10",
      "content": "오늘은 오를 것 같은데요",
      "createdAt": "2026-08-12T15:20:00.000Z",
      "author": { "id": "user_123", "nickname": "웃긴개미_241" },
      "canDelete": true,
      "hypeCount": 3,
      "isHypedByCurrentUser": false,
      "replies": [
        {
          "id": "comment_22",
          "parentCommentId": "comment_10",
          "content": "저도 그렇게 봐요",
          "createdAt": "2026-08-12T15:21:00.000Z",
          "author": { "id": "user_456", "nickname": "예뻐왕" },
          "canDelete": false,
          "hypeCount": 8,
          "isHypedByCurrentUser": true,
          "replies": []
        }
      ]
    }
  ]
}
```

### `POST /comments` (인증 필요)

```json
{
  "marketSessionId": "round-001-hoon",
  "targetId": "hoon",
  "parentCommentId": null,
  "content": "오늘은 오를 것 같은데요"
}
```

`parentCommentId`가 있으면 답글입니다. 서버는 시장이 `OPEN`인지, 부모 댓글이 같은 시장/종목에 속하는지 확인해야 합니다. 성공 시 목록 렌더링에 필요한 `author`, `canDelete`, `hypeCount`, `replies`를 포함한 `comment`를 반환합니다.

### `DELETE /comments/{commentId}` (인증 필요)

작성자 본인만 삭제할 수 있습니다. 시장 종료 뒤에도 기존 댓글 읽기와 본인 댓글 삭제를 허용할지는 운영 정책으로 정하되, 새 댓글/답글 생성은 차단합니다.

### `POST /comments/{commentId}/hype` (인증 필요)

```json
{ "marketSessionId": "round-001-hoon" }
```

서버는 `comment_hypes`의 `UNIQUE (user_id, market_session_id)` 위반을 처리해 이미 다른 댓글에 HYPE한 사용자를 막습니다. 동시 클릭에도 정확한 집계를 위해 INSERT와 HYPE 카운트 집계를 트랜잭션으로 처리합니다.

```json
{ "selectedCommentId": "comment_22", "bestCommentId": "comment_22" }
```

## 5. 종료와 정산

시장은 `ends_at <= serverNow`이면 서버가 `CLOSED`로 전환합니다. 프론트엔드의 타이머는 표시용이며, 투자/댓글 작성 가능 여부의 최종 판단은 항상 서버가 합니다.

1. 종료 작업이 모든 투자 로그를 읽어 승패·수익을 계산합니다.
2. 각 결과를 `settlements`에 저장하고, 지급 포인트를 `point_ledger`와 `users.points`에 한 번만 반영합니다.
3. `GET /me/investments`는 `settlementStatus`, `payout`, `profitLoss`를 포함해 사용자가 이전 시장 결과를 볼 수 있도록 반환합니다.
4. 별도 수령 UX가 필요하면 `POST /markets/{marketSessionId}/settlements/claim`을 추가하고, 중복 수령은 데이터베이스 UNIQUE 제약으로 차단합니다.

## 6. 프론트엔드 파일 연결 위치

| 파일 | 백엔드 연결 역할 |
| --- | --- |
| `scripts/api-config.js` | API 기본 주소 설정 |
| `scripts/market-runtime-bootstrap.js` | `/markets/current`으로 현재·종료 시장, 종목 정보, 다음 예약 시간 동기화 |
| `scripts/auth-service.js` | 회원가입, 로그인, `/auth/me`, 세션/토큰 |
| `scripts/investment-service.js` | 투자 생성, 포인트 잔액, 내 투자 로그 |
| `scripts/price-history-service.js` | 서버 OHLC 캔들 조회 |
| `scripts/comment-service.js` | 댓글/답글 조회·작성·삭제·HYPE |
| `scripts/comments-ui.js` | 서버 응답을 댓글 트리와 베스트 HYPE 표시로 렌더링 |
| `scripts/account-history-ui.js` | 내 투자 화면에 잔액과 투자 로그 렌더링 |

투자·정산 세부 계약과 PostgreSQL 마이그레이션은 [investment-settlement-api-contract.md](./investment-settlement-api-contract.md), [001_market_position_settlement.postgres.sql](./migrations/001_market_position_settlement.postgres.sql)를 우선 기준으로 사용합니다.
