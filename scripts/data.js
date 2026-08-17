// [컨셉 소개 데이터] 최초 접속 시 노출할 서비스 컨셉의 문구와 시각 요소를 한 곳에서 관리합니다.
window.MVP_DATA = {
  conceptIntroductionSlides: [
    // [컨셉 1] 조롱 거래소가 온라인 반응을 하나의 시장으로 바라보는 방식을 소개합니다.
    { title: '조롱 거래소에 오신 것을\n환영합니다.', description: '빠르게 흘러가는 온라인의 반응을 하나의 종목으로 만들고, 모두가 느끼는 오늘의 분위기를 시장으로 바꿉니다.', art: '<div class="concept-logo"><img src="./assets/jorong_logo.png" alt="조롱 거래소 로고" /></div>' },
    // [컨셉 2] 서로 다른 반응을 조롱과 옹호라는 두 가지 선택으로 표현합니다.
    { title: '같은 대상이라도,\n사람들의 마음은 서로 다릅니다.', description: '누군가는 조롱하고, 누군가는 옹호합니다. 우리는 어느 쪽이 맞는지 정하지 않습니다. 서로 다른 선택이 모이는 모습 자체가 오늘의 분위기가 됩니다.', art: '<div class="concept-choice-pair"><span class="concept-choice-roast">조롱</span><span class="concept-choice-support">옹호</span></div>' },
    // [컨셉 3] 의견과 선택이 쌓이면 집단 반응의 변화를 실시간으로 확인할 수 있습니다.
    { title: '우리의 의견이 가져오는 변화를\n실시간으로 확인할 수 있다면?', description: '한마디를 남기고 내가 믿는 방향에 투자해보세요. 사람들의 선택이 쌓일수록 가격은 그 순간의 집단 반응을 보여주는 기록이 됩니다.', art: '<div class="concept-flow"><span>조롱 / 옹호</span><i>+</i><span>선택</span><i>=</i><b>실시간 확인</b><div class="concept-mobile-timer" aria-hidden="true"><small>반응의 기록은 3시간</small><strong>02:59:56</strong></div></div>' },
    // [컨셉 완료] 마지막 화면의 시작하기 버튼을 누르면 컨셉 소개를 닫고 랜딩 페이지를 보여줍니다.
    { title: '', description: '', final: true, buttonLabel: '시작하기', art: '<div class="concept-logo concept-logo-final"><img src="./assets/jorong_logo.png" alt="조롱 거래소 로고" /></div>' },
  ],
};
