// [화면 전환] 랜딩·거래소·종목 상세·내 투자 화면을 새로고침 없이 전환합니다.
window.Navigation = (() => {
  const views = [...document.querySelectorAll('.view')];
  const appShell = document.querySelector('.app-shell');
  const exchangeViewIds = new Set(['exchange', 'board']);

  function show(viewId) {
    const target = document.querySelector(`#${viewId}`) || document.querySelector('#landing');
    views.forEach((view) => view.classList.toggle('is-active', view === target));
    // 거래소 화면에서만 전용 상단 메뉴와 계정 영역을 표시합니다.
    appShell.classList.toggle('is-exchange', exchangeViewIds.has(target.id));
    // [거래소 상단 탭] 현재 화면과 연결된 탭만 활성 색상으로 표시합니다.
    document.querySelectorAll('.exchange-header-nav [data-view]').forEach((button) => {
      button.classList.toggle('is-active', button.dataset.view === target.id);
    });
    // [화면 진입 알림] 종목 소개 모달처럼 특정 화면에 처음 진입할 때만 실행해야 하는 UI가 이 이벤트를 구독합니다.
    window.dispatchEvent(new CustomEvent('jorong:view-changed', { detail: { viewId: target.id } }));
    window.scrollTo({ top: 0, behavior: 'auto' });
  }

  // data-view 속성만 지정하면 어느 버튼에서든 같은 방식으로 화면을 이동할 수 있습니다.
  document.querySelectorAll('[data-view]').forEach((button) => {
    button.addEventListener('click', () => show(button.dataset.view));
  });

  return { show };
})();
