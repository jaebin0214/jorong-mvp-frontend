# 거래 회차 운영 가이드

현재 MVP에서는 [market-config.js](../scripts/market-config.js) 하나로 운영 종목과 거래 시간을 관리합니다. 운영자가 설정을 바꾼 뒤 사이트를 다시 배포하면 화면, 투자 요청, 댓글 요청, 타이머에 같은 값이 반영됩니다.

## 새 거래 회차 열기

`scripts/market-config.js`의 `DEFAULT_MARKET_CONFIG`를 아래 항목에 맞춰 수정합니다.

```js
session: {
  id: 'round-002-new-subject',
  startsAt: '2026-08-12T09:00:00+09:00',
  durationHours: 6,
  nextOpenAt: '2026-08-13T09:00:00+09:00',
},
subject: {
  id: 'new-subject',
  name: '새 종목 이름',
  imagePath: './assets/new-subject.png',
  initialPrice: 1000,
},
```

- `session.id`: 새 회차마다 반드시 고유한 값으로 변경합니다. 이전 회차의 브라우저 타이머 저장값과 분리하는 기준입니다.
- `session.startsAt`: 거래 시작 시각입니다. 한국 시간대라면 위 예시처럼 `+09:00`을 포함한 ISO 형식을 사용합니다.
- `session.durationHours`: 거래 진행 시간입니다. `6`, `4.5`, `0.5`처럼 시간 단위를 사용할 수 있습니다.
- `session.nextOpenAt`: 종료 화면에 표시할 다음 장 시작 시각입니다. 실제 운영에서는 서버의 `nextOpenAt` 응답이 우선합니다.
- `subject.id`: 댓글·투자 API로 전송되는 종목 ID입니다. 데이터베이스의 종목 ID와 같아야 합니다.
- `subject.name`: 거래소 화면에 표시되는 종목명입니다.
- `subject.imagePath`: `assets` 폴더에 넣은 이미지의 상대 경로입니다.
- `subject.initialPrice`: 거래 시작 전 가격입니다.

## 이미지 교체 순서

1. 새 이미지 파일을 `assets` 폴더에 넣습니다. 예: `assets/new-subject.png`
2. `subject.imagePath`를 `./assets/new-subject.png`로 바꿉니다.
3. `subject.name`, `subject.id`, `initialPrice`, `session.id`를 함께 변경합니다.
4. 수정 내용을 배포한 뒤 새 창에서 종목명·이미지·초기 가격·타이머를 확인합니다.

## 타이머 운영 원칙

`startsAt`을 설정하면 모든 사용자가 `시작 시각 + durationHours`라는 같은 종료 시각을 보므로 재접속하거나 다른 기기에서 접속해도 타이머가 갱신되지 않습니다.

`startsAt: null`은 데모 전용입니다. 이 경우 각 브라우저의 첫 접속 시점에 타이머가 시작되므로 실제 공개 운영에서는 사용하지 않는 편이 좋습니다.

## 서버 관리 타이머

실제 운영에서는 브라우저 저장소가 아닌 백엔드의 현재 거래 회차를 기준으로 타이머를 관리합니다. 프론트엔드는 `window.JORONG_API_BASE_URL`이 설정되면 `GET /markets/current/clock`을 호출해 서버 시각과 종료 시각을 동기화합니다.

응답 형식과 백엔드 구현 기준은 [market-clock-api-contract.md](./market-clock-api-contract.md)를 따릅니다. 이 방식을 쓰면 Edge, Whale, 모바일 등 서로 다른 브라우저도 동일한 종료 시각을 표시합니다.

## 백엔드 연결 이후

현재는 정적 설정 파일을 수정해 배포하는 방식입니다. 운영 페이지와 데이터베이스가 준비되면, 페이지가 로드되기 전에 아래 구조를 서버에서 주입하거나 `/market/current` API 응답으로 내려주면 됩니다.

```js
window.JORONG_MARKET_CONFIG = {
  session: { id: 'round-002-new-subject', startsAt: '2026-08-12T09:00:00+09:00', durationHours: 6 },
  subject: { id: 'new-subject', name: '새 종목 이름', imagePath: './assets/new-subject.png', initialPrice: 1000 },
};
```

운영 설정을 일반 사용자에게 노출하거나 브라우저에 저장하지 말고, 관리자 인증이 적용된 백엔드에서만 수정 권한을 주는 방식이 안전합니다.
