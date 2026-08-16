# 조롱 거래소 1차 MVP

피그마의 `concept introduction`과 `1차 MVP` 저해상도 와이어프레임을 기반으로 만든 별도 정적 시안입니다.

## 파일 구성

- `index.html` — 화면 구조와 정적 콘텐츠
- `styles/base.css` — 공통 색상·버튼·초기화
- `styles/layout.css` — 랜딩·프로필·내 투자 화면
- `styles/market.css` — 오늘의 종목·차트·댓글 영역
- `styles/concept-introduction.css` — 최초 진입 4장 컨셉 소개
- `styles/ingame-tutorial.css` — 거래소 기능을 강조하는 인게임 튜토리얼
- `styles/investment.css` — 첫 투자·내 투자 현황·추가 투자 카드
- `styles/settlement.css` — 장 종료 정산 결과와 다음 장 대기 화면
- `scripts/data.js` — 컨셉 소개 문구와 시각 요소 데이터
- `scripts/concept-introduction.js` — 컨셉 소개 진행·완료 저장
- `scripts/ingame-tutorial.js` — 회원가입 직후 첫 거래소 입장의 4단계 안내
- `scripts/financial-math.js` — BigInt 고정소수점 기반 수량·평균 단가·손익 계산
- `scripts/investment-service.js` — API 우선 주문·포지션·지갑·정산 데이터 서비스
- `scripts/investment-ui.js` — 투자 현황과 추가 투자 UI
- `scripts/market-settlement-ui.js` — 장 종료 정산 결과 UI
- `scripts/navigation.js` — 화면 전환
- `scripts/market-ui.js` — 투자 방향·금액의 시각 상태
- `scripts/app.js` — 앱 초기화와 임시 안내 메시지

`index.html`을 브라우저로 열면 됩니다. 컨셉 소개를 다시 보려면 랜딩 화면 하단의 `컨셉 소개 다시 보기` 버튼을 누르세요.

## 관리자 콘솔

`admin.html`을 열면 사용자용 화면과 분리된 관리자 콘솔을 확인할 수 있습니다. API 미연결 상태에서는 `jorong_admin_demo_v1` 네임스페이스의 로컬 시연 데이터로 동작하며, 종목 예약·댓글 처리·운영진 댓글·크레딧 조정·감사 기록을 새로고침 뒤에도 보관합니다. 실제 관리자 API 계약은 [admin-api-contract.md](./docs/admin-api-contract.md)에 정리했습니다.

### 로컬 거래소 연동 시연

API 주소가 비어 있을 때 `admin.html`에서 `LIVE` 상태인 종목은 `index.html`의 거래소에도 자동 반영됩니다. 관리자와 거래소를 같은 브라우저·같은 배포 주소에서 열면, 관리자 탭의 저장 후 거래소 탭이 자동으로 새로고침되어 종목명·이미지·기준 가격·거래 시간이 바뀐 것을 확인할 수 있습니다.

1. 기존 거래 중 종목을 종료합니다.
2. 초안 종목을 만들거나 예약 종목을 초안으로 되돌려 편집합니다.
3. 이미지·종목명·기준 가격·시작/종료 시간을 저장하고 `예약 저장`합니다.
4. 해당 종목의 `거래 시작`을 누릅니다.
5. 거래소 탭에서 새 LIVE 종목을 확인합니다.

이 연결은 개발 시연 전용입니다. `window.JORONG_API_BASE_URL`이 설정되면 로컬 브리지는 동작하지 않으며, 이후에는 Supabase를 포함한 백엔드의 현재 시장 API가 항상 우선합니다.

실제 관리자 API가 준비된 뒤에만 아래 값을 함께 설정하세요. 관리자 권한 검사는 반드시 서버에서 처리해야 합니다.

```html
<script>
  window.JORONG_API_BASE_URL = 'https://api.example.com';
  window.JORONG_ADMIN_API_ENABLED = true;
</script>
```

## 인게임 튜토리얼 흐름

회원가입을 완료한 계정으로 로그인하면 거래소에 진입합니다. 기존 종목 소개 창을 닫은 뒤, `타이머 → 조롱 작성 → 투자 → 가격 그래프` 순서로 안내가 진행됩니다. 다음 가입 과정에서만 실행되도록 임시 상태를 브라우저 세션에 보관하며, 백엔드 연결 후에는 로그인 응답의 `needsIngameTutorial` 같은 값으로 대체할 수 있습니다.

## 투자·정산 연동

현재 정적 MVP는 API 주소가 비어 있을 때 브라우저 저장소에 로컬 시연용 주문·포지션·정산 원장을 보관합니다. 실제 운영에서는 `window.JORONG_API_BASE_URL`을 설정해 서버 API를 사용해야 합니다. 백엔드 구현 기준은 [investment-settlement-api-contract.md](./docs/investment-settlement-api-contract.md), DB 초안은 [001_market_position_settlement.postgres.sql](./docs/migrations/001_market_position_settlement.postgres.sql)에 정리되어 있습니다.

화면별로 프론트가 보내고 받는 데이터, 로컬 시연 여부, Supabase 구현 시 서버 책임은 [frontend-backend-data-map.md](./docs/frontend-backend-data-map.md)에 정리했습니다.

계산 예시는 아래 기본 테스트로 검증할 수 있습니다.

```powershell
node --test .\tests\financial-math.test.js
node --test .\tests\admin-service.test.js
```
