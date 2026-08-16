# 프론트엔드 · 백엔드 데이터 연결 현황

이 문서는 현재 정적 프론트엔드가 화면별로 보내고 받는 데이터를 정리한 인수인계용 문서입니다. `window.JORONG_API_BASE_URL`이 비어 있으면 같은 화면은 **로컬 시연 모드**로 동작하며, 값이 있으면 아래 HTTP API를 사용합니다. 로컬 저장소는 데모 확인용일 뿐, 실제 사용자 데이터의 원본이 아닙니다.

## 연결 설정

```html
<!-- api-config.js보다 먼저 배포 환경에서 주입 -->
<script>
  window.JORONG_API_BASE_URL = 'https://api.example.com';
  window.JORONG_ADMIN_API_ENABLED = true; // 관리자 API까지 연결할 때만
</script>
```

- 인증은 `HttpOnly; Secure` 쿠키가 우선이며, Bearer 토큰 응답도 현재 브라우저 탭 동안 지원합니다.
- 백엔드는 CORS에서 프론트 배포 도메인을 허용하고 `credentials: include` 사용 시 정확한 origin과 `Access-Control-Allow-Credentials: true`를 설정해야 합니다.
- Supabase를 쓸 경우 service-role 키는 브라우저에 넣지 않고 Edge Function 또는 자체 API 서버에서만 사용합니다.

## 사용자 화면

| 위치 / 파일 | 프론트 → 백엔드 | 백엔드 → 프론트 | 로컬 시연 | API 연결 준비 |
| --- | --- | --- | --- | --- |
| 회원가입·로그인·상단 프로필 `auth-service.js` | `nickname`(화면 표기: 아이디), `password`; 로그아웃 요청 | `account{id,nickname}`, `wallet.points`, 투자 요약, 세션 쿠키 또는 토큰 | 가능. 비밀번호는 메모리에만, 계정 요약·탭 세션만 저장 | 완료: `/auth/*` |
| 현재 시장·종목 설명·다음 장 `market-runtime-bootstrap.js`, `market-config.js` | 공개 조회 | `displayMarket`의 ID·상태·종목명·이미지 URL·기준가·개장/마감·다음 개장, `serverNow` | 가능. `jorong_admin_demo_v1`의 LIVE/종료/예약 시장을 읽음 | **이번에 추가**: `GET /markets/current` |
| 타이머 `countdown.js` | 공개 조회 | `marketSessionId`, `status`, `openAt`, `closeAt`, `nextOpenAt`, `serverNow` | 가능. 브라우저 저장소/관리자 시연 시간을 사용 | 완료: `GET /markets/current/clock` |
| 첫·추가 투자와 내 투자 현황 `investment-service.js`, `investment-ui.js` | `marketId`, `targetId`, `side(SUPPORT|MOCK)`, 정수 `investmentAmount`, `idempotencyKey` | 주문 체결가·추가 수량·포지션(방향/총 투자금/수량/평균 단가), 손익/수익률/평가금액, 최신 잔액, 시장 비율 | 가능. 계정별 로컬 원장으로 계산 | 완료: `POST /markets/{marketId}/orders`, `GET /markets/{marketId}/me/position` |
| 내 투자 이력 `account-history-ui.js` | 인증된 개인 조회 | `wallet`, 모든 회차의 `investments` 또는 `investmentLogs` | 현재 회차 원장만 표시 | **이번에 실제 호출로 보완**: `GET /me/investments` |
| 실시간 캔들 차트 `price-history-service.js` | 시장·종목 ID, 집계 단위 | 전체 참여자의 `candles`(OHLC, volume, initialPrice) | 가능. 같은 브라우저 origin의 모든 로컬 주문을 집계 | 완료: `GET /markets/{marketId}/candles` |
| 댓글·답글·HYPE·내 댓글 삭제 `comment-service.js`, `comments-ui.js` | 댓글 내용, 부모 댓글 ID, 시장/종목 ID; HYPE 대상; 삭제 대상 | 댓글 트리, 작성자, 상태, HYPE 수, 내 HYPE, 베스트 댓글, 삭제 권한 | 가능. `jorong-mvp-local-comments-v1` | 완료: 댓글 API 4종. 삭제/HYPE 권한은 서버가 최종 검증 |
| 종료 정산·정산 화면 `market-settlement-ui.js` | 개인 정산 조회 | 마감가, 포지션, 실현손익/수익률/지급액, 정산 후 잔액, 옹호·조롱 비율·거래량·참여자, 다음 개장 | 가능. 로컬 원장 정산 | 완료: `GET /markets/{marketId}/me/settlement`; 종료·지급은 서버 작업 |
| 사이클 리포트 `cycle-report-service.js`, `cycle-report-ui.js` | 로그인 사용자 리포트 조회 | 시장별 정산, 개인 포지션, 시장 요약, 사용자가 쓴 댓글/답글 | 가능. 사용자별 localStorage 스냅샷 | 완료: `GET /me/cycle-reports` |
| 컨셉 소개·인게임 튜토리얼 | 없음 | 없음 | 가능. 표시 여부만 local/sessionStorage | 서버 저장 불필요한 UI 선호값 |
| 게시판 | 글쓰기 시 ‘준비 중’ 알림만 표시 | 없음 | 정적 빈 UI | 게시판 CRUD는 아직 범위 밖 |

## 관리자 화면

관리자 API는 일반 사용자 API가 배포돼 있어도 `window.JORONG_ADMIN_API_ENABLED = true`일 때만 호출합니다. 실제 권한은 URL 숨김이 아니라 서버의 관리자 역할 검사로 보호해야 합니다.

| 위치 / 파일 | 프론트 → 백엔드 | 백엔드 → 프론트 | 로컬 시연 | API 연결 준비 |
| --- | --- | --- | --- | --- |
| 대시보드 `admin-service.js`, `admin-ui.js` | 조회 | LIVE 시장, 예약 목록, 참여 추세, 댓글/거래 지표 | 가능. `jorong_admin_demo_v1` | 완료: `GET /admin/dashboard` |
| 종목 생성·편집·예약·시작·종료·정산·보관 | 종목명, 소개/설명, 이미지 URL, 시작/종료, 기준가, 운영 옵션, 대상 ID, 멱등 키 | 갱신된 시장 목록·상태 | 가능 | 완료: `/admin/markets*` |
| 종목 복제 | 원본 `marketId`, `Idempotency-Key` | 새 DRAFT 시장 | 가능 | **이번에 API 어댑터와 계약 추가**: `POST /admin/markets/{marketId}/duplicate` |
| 종목 이미지 선택 | multipart `file` | 서버가 검사·저장한 `imageUrl` | 가능. Data URL 미리보기 | **이번에 API 어댑터와 계약 추가**: `POST /admin/market-images` |
| 댓글 운영 | 숨김/해제/소프트 삭제 사유, 운영진 댓글·공지·고정 여부 | 댓글 목록·상태·운영진 식별자 | 가능 | 완료: `/admin/comments*` |
| 사용자·크레딧·제한 | 사용자 ID, 조정 금액/사유, 제한 상태/사유, 멱등 키 | 사용자 요약·지갑 변경 결과 | 가능 | 완료: `/admin/users*` |
| 운영 기록 | 조회 | 생성/수정/종료/댓글 처리/크레딧 조정 이력 | 가능 | 완료: `GET /admin/audit-logs` |

## Supabase 구현 기준

1. **인증**: Supabase Auth의 `auth.users.id`를 기준으로 `profiles`/`wallets`를 연결합니다. 비밀번호는 프론트의 요청 본문으로 직접 저장하지 않고 Auth에 맡깁니다.
2. **거래 데이터**: `markets`, `investment_orders`, `positions`, `settlements`, `wallet_transactions`, `price_candles`를 사용합니다. 제공된 [마이그레이션](./migrations/001_market_position_settlement.postgres.sql)의 NUMERIC·UNIQUE 제약을 유지합니다.
3. **커뮤니티 데이터**: `comments`, `comment_hypes`를 만들고, `UNIQUE(user_id, market_id)`으로 한 시장 HYPE 하나를 보장합니다. 댓글 삭제는 soft delete로 보존합니다.
4. **운영 데이터**: 시장·댓글·지갑 수정마다 `admin_audit_logs`를 서버 트랜잭션에서 기록합니다. 상태 전환과 정산은 Edge Function/서버 작업에서 처리합니다.
5. **이미지**: `market-images` Storage 버킷에 업로드하고, API는 URL만 프론트에 반환합니다. Storage service-role 키는 절대 클라이언트에 노출하지 않습니다.

## 서버가 최종 책임져야 하는 항목

- 사용자 인증·관리자 권한·RLS
- 잔액 차감, 반대 포지션 거부, 가격·캔들 갱신, 정산 지급의 트랜잭션과 멱등성
- 시장 상태 전환과 서버 시계, 예약 자동 시작·종료·정산
- 댓글 작성 가능 여부, 본인 삭제 권한, HYPE 중복 방지
- 이미지 파일 검사와 Storage 저장

세부 요청·응답은 [backend-integration-guide.md](./backend-integration-guide.md), [investment-settlement-api-contract.md](./investment-settlement-api-contract.md), [comment-api-contract.md](./comment-api-contract.md), [market-runtime-api-contract.md](./market-runtime-api-contract.md), [admin-api-contract.md](./admin-api-contract.md)를 함께 사용합니다.
