# 조롱 거래소 1차 MVP

피그마의 `tutorial slide`와 `1차 MVP` 저해상도 와이어프레임을 기반으로 만든 별도 정적 시안입니다.

## 파일 구성

- `index.html` — 화면 구조와 정적 콘텐츠
- `styles/base.css` — 공통 색상·버튼·초기화
- `styles/layout.css` — 랜딩·프로필·내 투자 화면
- `styles/market.css` — 오늘의 종목·차트·댓글 영역
- `styles/tutorial.css` — 최초 진입 9장 튜토리얼
- `scripts/data.js` — 튜토리얼 문구와 미니 UI 데이터
- `scripts/tutorial.js` — 튜토리얼 진행·완료 저장
- `scripts/navigation.js` — 화면 전환
- `scripts/market-ui.js` — 투자 방향·금액의 시각 상태
- `scripts/app.js` — 앱 초기화와 임시 안내 메시지

`index.html`을 브라우저로 열면 됩니다. 튜토리얼을 다시 보려면 개발자 도구의 Local Storage에서 `jorong-mvp-tutorial-complete` 키를 삭제하세요.
