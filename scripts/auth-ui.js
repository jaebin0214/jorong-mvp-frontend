// [인증 UI] 회원가입·로그인 폼과 AuthService를 연결하고, API 도입 전에도 같은 흐름을 확인하게 합니다.
(() => {
  const signupForm = document.querySelector('#signup-form');
  const loginForm = document.querySelector('#login-form');
  const nicknameInput = document.querySelector('#signup-nickname');
  const nicknameCheckButton = document.querySelector('#signup-nickname-check');
  const toast = document.querySelector('#toast');
  let toastTimer;

  if (!window.AuthService || !signupForm || !loginForm || !toast) return;

  // [알림] 공통 토스트를 사용해 API 응답, 입력 오류, 성공 상태를 같은 방식으로 안내합니다.
  function showToast(message) {
    toast.textContent = message;
    toast.classList.add('is-visible');
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toast.classList.remove('is-visible'), 2400);
  }

  // [제출 상태] 네트워크 요청 중 중복 제출을 막고 버튼의 현재 상태를 알려줍니다.
  function setPending(button, isPending, pendingLabel) {
    button.disabled = isPending;
    button.textContent = isPending ? pendingLabel : button.dataset.defaultLabel;
  }

  // [아이디 중복 확인] 내부 API 필드명(nickname)은 유지하고, 화면 문구만 아이디로 표기합니다.
  nicknameCheckButton.addEventListener('click', async () => {
    try {
      const result = await window.AuthService.checkNicknameAvailability(nicknameInput.value);
      showToast(result.available ? '사용 가능한 아이디입니다.' : '이미 사용 중인 아이디입니다.');
    } catch (error) {
      showToast(error.message);
    }
  });

  // [회원가입 제출] 아이디·비밀번호를 API 계약의 nickname 필드로 전달한 뒤 로그인 화면으로 이동합니다.
  signupForm.addEventListener('submit', async (event) => {
    event.preventDefault();

    const nickname = nicknameInput.value.trim();
    const password = document.querySelector('#signup-password').value;
    const passwordConfirm = document.querySelector('#signup-password-confirm').value;
    const hasAgreed = document.querySelector('#signup-terms').checked;
    const submitButton = document.querySelector('#signup-submit');

    if (password !== passwordConfirm) {
      showToast('비밀번호 확인이 일치하지 않습니다.');
      return;
    }
    if (!hasAgreed) {
      showToast('필수 이용약관에 동의해주세요.');
      return;
    }

    try {
      setPending(submitButton, true, '가입 처리 중…');
      const result = await window.AuthService.signup({ nickname, password });
      // [인게임 튜토리얼 예약] 이번 회원가입으로 만든 계정만 다음 거래소 입장에서 안내를 실행합니다.
      window.IngameTutorial?.scheduleAfterSignup(result.account);
      signupForm.reset();
      document.querySelector('#signup-terms').checked = true;
      showToast(`${result.account.nickname}님, 회원가입이 완료되었습니다. 로그인해주세요.`);
      window.Navigation.show('login');
    } catch (error) {
      showToast(error.message);
    } finally {
      setPending(submitButton, false, '');
    }
  });

  // [로그인 제출] 성공 응답의 계정 정보는 AuthService가 보관하며, 현재 MVP에서는 거래소로 이동합니다.
  loginForm.addEventListener('submit', async (event) => {
    event.preventDefault();

    const nickname = document.querySelector('#login-nickname').value.trim();
    const password = document.querySelector('#login-password').value;
    const submitButton = document.querySelector('#login-submit');

    try {
      setPending(submitButton, true, '로그인 중…');
      const result = await window.AuthService.login({ nickname, password });
      loginForm.reset();
      showToast(`${result.account.nickname}님, 로그인되었습니다.`);
      window.Navigation.show('exchange');
      // [인게임 튜토리얼 시작] 종목 소개 모달이 있으면 해당 모달이 닫힌 뒤 자동으로 이어집니다.
      window.IngameTutorial?.startAfterLogin(result.account);
    } catch (error) {
      showToast(error.message);
    } finally {
      setPending(submitButton, false, '');
    }
  });

  // [초기 라벨] setPending이 원래 버튼 문구를 복원할 수 있도록 미리 저장합니다.
  document.querySelectorAll('#signup-submit, #login-submit').forEach((button) => {
    button.dataset.defaultLabel = button.textContent;
  });
})();
