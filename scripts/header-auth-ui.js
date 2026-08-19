// [상단 회원 UI] 로그인 세션 이벤트에 맞춰 로그인 버튼과 회원 아이디 표시를 전환합니다.
(() => {
  const landingPrompt = document.querySelector('.landing-header-actions .account-prompt');
  const landingLoginButton = document.querySelector('.landing-header-actions .header-login');
  const landingProfile = document.querySelector('#landing-header-profile');
  const landingMemberName = document.querySelector('#landing-header-member');
  const landingLogoutButton = document.querySelector('#landing-header-logout');
  const exchangeLoginButton = document.querySelector('.exchange-header-actions [data-view="login"]');
  const exchangeProfile = document.querySelector('#exchange-header-profile');
  const exchangeMemberName = document.querySelector('#exchange-header-member');
  const exchangeLogoutButton = document.querySelector('#exchange-header-logout');
  const balanceLabels = [...document.querySelectorAll('[data-header-balance]')];
  const profiles = [
    { container: landingProfile, trigger: landingMemberName, logout: landingLogoutButton },
    { container: exchangeProfile, trigger: exchangeMemberName, logout: exchangeLogoutButton },
  ];

  function closeProfileMenus() {
    profiles.forEach(({ container, trigger, logout }) => {
      container?.classList.remove('is-open');
      if (trigger) trigger.setAttribute('aria-expanded', 'false');
      if (logout) logout.hidden = true;
    });
  }

  // [공통 보유 크레딧] 랜딩과 거래소 계정 영역이 서로 다른 DOM을 쓰더라도
  // 같은 지갑 값을 즉시 표시하도록 한곳에서 동기화합니다.
  function renderBalance(points, isLoggedIn = Boolean(window.AuthService?.getCurrentAccount?.())) {
    const safePoints = Number.isFinite(Number(points)) ? Math.max(0, Math.floor(Number(points))) : 0;
    const display = `${safePoints.toLocaleString('ko-KR')} 크레딧`;
    balanceLabels.forEach((label) => {
      label.hidden = !isLoggedIn;
      if (isLoggedIn) label.textContent = display;
    });
  }

  // [회원 상태 렌더링] 로그인하면 아이디만 보이고, 로그아웃하면 로그인 진입 버튼을 다시 보여줍니다.
  function render(account) {
    const nickname = String(account?.nickname || '').trim();
    const isLoggedIn = Boolean(nickname);

    if (landingPrompt) landingPrompt.hidden = isLoggedIn;
    if (landingLoginButton) landingLoginButton.hidden = isLoggedIn;
    if (landingProfile) landingProfile.hidden = !isLoggedIn;
    if (landingMemberName) {
      landingMemberName.textContent = isLoggedIn ? `${nickname}님` : '';
    }

    if (exchangeLoginButton) exchangeLoginButton.hidden = isLoggedIn;
    if (exchangeProfile) exchangeProfile.hidden = !isLoggedIn;
    if (exchangeMemberName) {
      exchangeMemberName.textContent = isLoggedIn ? `${nickname}님` : '';
    }
    renderBalance(account?.points, isLoggedIn);
    if (!isLoggedIn) closeProfileMenus();
  }

  profiles.forEach(({ container, trigger, logout }) => {
    trigger?.addEventListener('click', (event) => {
      event.stopPropagation();
      if (!window.AuthService?.getCurrentAccount?.()) return;
      const willOpen = !container.classList.contains('is-open');
      closeProfileMenus();
      if (!willOpen) return;
      container.classList.add('is-open');
      trigger.setAttribute('aria-expanded', 'true');
      if (logout) logout.hidden = false;
    });
    logout?.addEventListener('click', async () => {
      logout.disabled = true;
      try {
        await window.AuthService?.logout?.();
        window.Navigation?.show?.('landing');
      } finally {
        logout.disabled = false;
        closeProfileMenus();
      }
    });
  });
  document.addEventListener('click', (event) => {
    if (!profiles.some(({ container }) => container?.contains(event.target))) closeProfileMenus();
  });
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeProfileMenus();
  });

  window.addEventListener('jorong:auth-session', (event) => render(event.detail?.account));
  render(window.AuthService?.getCurrentAccount?.());
  window.HeaderAuthUI = Object.freeze({ render, setBalance: renderBalance });
})();
