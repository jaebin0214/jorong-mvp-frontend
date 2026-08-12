// [화면 데이터] 추후 API 연결 전까지 튜토리얼 문구와 정적 미니 UI를 한 파일에서 관리합니다.
window.MVP_DATA = {
  tutorialSlides: [
    { progress: 0, title: '조롱 거래소에 오신 것을 환영합니다', description: '', art: '<div class="tour-logo"><img class="tour-logo-image" src="./assets/jorong_logo.png" alt="조롱 거래소 로고" /></div>' },
    { progress: 1, title: '매일 조롱 종목이 갱신 됩니다.', description: '하루에 하나의 종목이 열리고, 타이머가 끝나면 거래도 종료됩니다.', art: '<img class="tour-slide-image" src="./assets/tutorial2.png" alt="오늘의 조롱 종목 화면" />' },
    { progress: 2, title: '먼저, 조롱을 남겨주세요', description: '종목에 대한 조롱을 작성하면 투자 권한이 열립니다.', art: '<div class="tour-permission"><div class="tour-comment"><header><span class="avatar">웃</span>웃긴개미_241</header><p>“맨날 사고 치지만 없으면 또 허전함”</p><span>댓글 작성 완료</span></div><div class="tour-arrow">→</div><div class="permission-badge"><b>✓</b>투자 권한 획득</div></div>' },
    { progress: 2, title: '옹호 또는 조롱을 선택하세요.', description: '방향을 정하고, 보유 금액 안에서 원하는 만큼 투자합니다.', art: '<div class="tour-order"><span>투자 방향</span><div class="tour-order-tabs"><b>옹호 ↑</b><b>조롱 ↓</b></div><span>투자 금액</span><div class="tour-field">5,000 KRW <span>− &nbsp;+</span></div><div class="tour-order-footer">투자하기</div></div>' },
    // [튜토리얼 5] 전달받은 차트 이미지를 다섯 번째 안내 화면에 표시합니다.
    { progress: 2, title: '사람들의 선택이 가격을 움직입니다.', description: '옹호와 조롱의 흐름에 따라 가격이 계속 변합니다.', art: '<img class="tour-slide-image" src="./assets/tutorial5.png" alt="가격 변동 차트 화면" />' },
    { progress: 2, title: '댓글과 답글이 시장의 재미를 만듭니다.', description: '옹호와 조롱의 흐름에 따라 가격이 계속 변합니다.', art: '<div class="tour-community"><div class="tour-community-head"><h3>조롱 커뮤니티</h3><span>인기순</span></div><div class="tour-community-main"><span class="avatar">웃</span><div><h4>웃긴개미_241</h4><p>맨날 사고 치지만 없으면 또 허전함</p><footer><span>HYPE 1,204</span><span>답글 48</span></footer></div></div><div class="tour-reply"><b>광고에진심</b><p>근데 5살부터 꼭 조용할 때 배신하는 거 보면 근본이 쎄은 게 보이는 캐릭터임</p></div></div>' },
    { progress: 2, title: 'HYPE은 하루 3번 만 할 수 있습니다.', description: '신중한 사용으로 정말 유쾌한 댓글에만 사용해주세요.', art: '<div class="tour-hype"><div class="tour-community"><div class="tour-community-head"><h3>조롱 커뮤니티</h3></div><div class="tour-community-main"><span class="avatar">웃</span><div><h4>웃긴개미_241</h4><p>맨날 사고 치지만 없으면 또 허전함</p><footer><span>HYPE 1,204</span><span>답글 48</span></footer></div></div></div><div class="tour-arrow">↗</div></div>' },
    { progress: 3, title: '타이머가 끝나면 오늘의 결과가 결정됩니다.', description: '결과를 확인하고, 투자 결과에 따른 보상을 수령하세요.', art: '<div class="tour-result"><span>거래 종료</span><div class="tour-result-grid"><div><small>최종 가격</small><b>1,310 KRW <em class="result-change">+31.0%</em></b></div><div><small>옹호</small><b class="blue">68%</b></div><div><small>조롱</small><b class="red">32%</b></div></div><p>오늘의 베스트 댓글<b>“없으면 허전한데 있으면 또 사고 침”</b></p></div>' },
    // [튜토리얼 완료] 마지막 안내 화면에는 서비스 로고를 표시합니다.
    { progress: 4, title: '이제 조롱해보시죠 잘 할 수 있다면 ㅋ', description: '', art: '<div class="tour-logo"><img class="tour-logo-image" src="./assets/jorong_logo.png" alt="조롱 거래소 로고" /></div>' },
  ],
  progressTargets: [0, 1, 2, 7, 8],
};
