// [상단 회원 UI] 로그인 세션 이벤트에 맞춰 로그인/회원가입 버튼과 회원 닉네임 표시를 전환합니다.
(() => {
  const landingPrompt = document.querySelector('.landing-header-actions .account-prompt');
  const landingLoginButton = document.querySelector('.landing-header-actions .header-login');
  const landingMemberName = document.querySelector('#landing-header-member');
  const exchangeLoginButton = document.querySelector('.exchange-header-actions [data-view="login"]');
  const exchangeSignupButton = document.querySelector('.exchange-header-actions .exchange-signup');
  const exchangeMemberName = document.querySelector('#exchange-header-member');

  // [회원 상태 렌더링] 로그인하면 닉네임만 보이고, 로그아웃하면 원래의 로그인·회원가입 진입 버튼을 다시 보여줍니다.
  function render(account) {
    const nickname = String(account?.nickname || '').trim();
    const isLoggedIn = Boolean(nickname);

    if (landingPrompt) landingPrompt.hidden = isLoggedIn;
    if (landingLoginButton) landingLoginButton.hidden = isLoggedIn;
    if (landingMemberName) {
      landingMemberName.hidden = !isLoggedIn;
      landingMemberName.textContent = isLoggedIn ? `${nickname}님` : '';
    }

    if (exchangeLoginButton) exchangeLoginButton.hidden = isLoggedIn;
    if (exchangeSignupButton) exchangeSignupButton.hidden = isLoggedIn;
    if (exchangeMemberName) {
      exchangeMemberName.hidden = !isLoggedIn;
      exchangeMemberName.textContent = isLoggedIn ? `${nickname}님` : '';
    }
  }

  window.addEventListener('jorong:auth-session', (event) => render(event.detail?.account));
  render(window.AuthService?.getCurrentAccount?.());
  window.HeaderAuthUI = Object.freeze({ render });
})();
