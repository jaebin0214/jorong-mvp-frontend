// [화면 전환] 랜딩·거래소·종목 상세·내 투자 화면을 새로고침 없이 전환합니다.
window.Navigation = (() => {
  const views = [...document.querySelectorAll('.view')];
  const appShell = document.querySelector('.app-shell');
  const exchangeViewIds = new Set(['exchange', 'board', 'cycle-report']);

  function show(viewId) {
    const target = document.querySelector(`#${viewId}`) || document.querySelector('#landing');
    views.forEach((view) => view.classList.toggle('is-active', view === target));
    // 거래소 화면에서만 전용 상단 메뉴와 계정 영역을 표시합니다.
    appShell.classList.toggle('is-exchange', exchangeViewIds.has(target.id));
    // [정산 전용 모바일 헤더] 정산 결과는 exchange 화면 안에서만 표시되므로,
    // 리포트·게시판 등으로 이동한 뒤에도 정산 헤더가 남지 않게 여기서 함께 동기화합니다.
    const settlementView = document.querySelector('#market-settlement-view');
    appShell.classList.toggle('is-market-settlement', target.id === 'exchange' && settlementView && !settlementView.hidden);
    // [거래소 상단 탭] 현재 화면과 연결된 탭만 활성 색상으로 표시합니다.
    document.querySelectorAll('.exchange-header-nav [data-view]').forEach((button) => {
      button.classList.toggle('is-active', button.dataset.view === target.id);
    });
    // [화면 진입 알림] 종목 소개 모달처럼 특정 화면에 처음 진입할 때만 실행해야 하는 UI가 이 이벤트를 구독합니다.
    window.dispatchEvent(new CustomEvent('jorong:view-changed', { detail: { viewId: target.id } }));
    window.scrollTo({ top: 0, behavior: 'auto' });
  }

  // data-view 속성만 지정하면 어느 버튼에서든 같은 방식으로 화면을 이동할 수 있습니다.
  // 단, 랜딩의 시작하기는 비로그인 사용자를 먼저 로그인 화면으로 안내합니다.
  document.querySelectorAll('[data-view]').forEach((button) => {
    button.addEventListener('click', () => {
      // [개인 리포트 보호] 개인 투자·정산 정보 화면은 로그인한 사용자만 열 수 있습니다.
      if (button.dataset.requiresAuth === 'true' && !window.AuthService?.getCurrentAccount?.()) {
        show('login');
        return;
      }
      if (button.id === 'landing-start') {
        const isLoggedIn = Boolean(window.AuthService?.getCurrentAccount?.());
        show(isLoggedIn ? 'exchange' : 'login');
        return;
      }
      show(button.dataset.view);
    });
  });

  return { show };
})();
