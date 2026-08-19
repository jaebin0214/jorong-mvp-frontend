// [화면 전환] 랜딩·거래소·종목 상세·내 투자 화면을 새로고침 없이 전환합니다.
window.Navigation = (() => {
  const views = [...document.querySelectorAll('.view')];
  const appShell = document.querySelector('.app-shell');
  const exchangeViewIds = new Set(['exchange', 'board', 'cycle-report']);
  const protectedViewIds = new Set(['cycle-report']);
  // [URL 경로] 정적 사이트에서도 새로고침·공유 링크·뒤로가기를 복원하기 위해
  // 각 화면 ID를 URL 해시(#exchange 등)와 1:1로 연결합니다.
  const viewIds = new Set(views.map((view) => view.id));

  function normaliseViewId(viewId) {
    return viewIds.has(viewId) ? viewId : 'landing';
  }

  function getViewIdFromLocation() {
    const hash = window.location.hash.replace(/^#/, '');
    try {
      return normaliseViewId(decodeURIComponent(hash));
    } catch {
      // 잘못 인코딩된 주소도 랜딩으로 안전하게 처리합니다.
      return 'landing';
    }
  }

  // [직접 주소 접근 보호] 버튼의 data-requires-auth 검사와 같은 기준을 URL 진입에도 적용합니다.
  // navigation.js가 인증 모듈보다 먼저 로드되므로, 세션 복원 뒤 restoreLocation()으로 한 번 더 판정합니다.
  function resolveAccessibleViewId(viewId) {
    const safeViewId = normaliseViewId(viewId);
    const account = window.AuthService?.getCurrentAccount?.();
    // Supabase의 getSession()은 비동기이므로 완료 전에는 현재 계정이 일시적으로 비어 있습니다.
    // 이 순간 #cycle-report를 #login으로 바꾸면 세션 복원 뒤에도 원래 주소를 알 수 없게 됩니다.
    const isSessionRestored = window.AuthService?.isSessionRestored?.() === true;
    if (protectedViewIds.has(safeViewId) && window.AuthService && isSessionRestored && !account) return 'login';
    return safeViewId;
  }

  function updateLocation(viewId, { replace = false } = {}) {
    const nextHash = `#${encodeURIComponent(viewId)}`;
    if (window.location.hash === nextHash) return;

    // history API는 화면을 다시 그리지 않으면서도 뒤로가기·공유 URL을 지원합니다.
    // 일부 저장소 제한 환경에서는 hash 대입으로 자연스럽게 대체합니다.
    try {
      if (replace) window.history.replaceState(null, '', nextHash);
      else window.history.pushState(null, '', nextHash);
    } catch {
      window.location.hash = nextHash;
    }
  }

  function show(viewId, { syncUrl = true, replaceUrl = false, scrollToTop = true } = {}) {
    const safeViewId = resolveAccessibleViewId(viewId);
    const target = document.querySelector(`#${safeViewId}`) || document.querySelector('#landing');
    if (syncUrl) updateLocation(target.id, { replace: replaceUrl });
    views.forEach((view) => view.classList.toggle('is-active', view === target));
    // 거래소 화면에서만 전용 상단 메뉴와 계정 영역을 표시합니다.
    appShell?.classList.toggle('is-exchange', exchangeViewIds.has(target.id));
    // 랜딩도 같은 상단 탭으로 다른 주요 화면을 이동할 수 있도록 별도 상태를 둡니다.
    appShell?.classList.toggle('is-landing', target.id === 'landing');
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
    if (scrollToTop) window.scrollTo({ top: 0, behavior: 'auto' });
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

  // [브라우저 탐색] 주소창에 직접 입력하거나, 뒤로가기·앞으로가기를 해도 해당 화면을 다시 표시합니다.
  // show()에서 history.pushState를 사용하므로 일반 화면 이동 때는 hashchange가 중복 발생하지 않습니다.
  window.addEventListener('hashchange', () => {
    const requestedViewId = getViewIdFromLocation();
    const resolvedViewId = resolveAccessibleViewId(requestedViewId);
    show(resolvedViewId, {
      syncUrl: resolvedViewId !== requestedViewId,
      replaceUrl: true,
    });
  });

  function restoreLocation({ scrollToTop = false } = {}) {
    const requestedViewId = getViewIdFromLocation();
    const resolvedViewId = resolveAccessibleViewId(requestedViewId);
    show(resolvedViewId, {
      // 접근이 허용되지 않은 개인 화면만 로그인 주소로 교체하고, 나머지 해시는 그대로 유지합니다.
      syncUrl: resolvedViewId !== requestedViewId,
      replaceUrl: true,
      scrollToTop,
    });
  }

  // [첫 진입 복원] 해시가 없던 기존 링크는 랜딩 URL로 교체하고, 해시 링크는 즉시 해당 화면을 엽니다.
  // 뒤쪽에서 로드되는 거래소·리포트 UI도 최초 화면 이벤트를 받을 수 있도록 load 시 한 번 더 알립니다.
  const initialViewId = getViewIdFromLocation();
  show(initialViewId, { replaceUrl: !window.location.hash });
  window.addEventListener('load', () => {
    restoreLocation({ scrollToTop: false });
  }, { once: true });

  return Object.freeze({ show, getCurrentView: getViewIdFromLocation, restoreLocation });
})();
