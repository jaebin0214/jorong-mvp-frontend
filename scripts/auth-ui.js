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

  // [복구 코드 표시] 서버가 가입 시 딱 한 번만 내려주는 값이라, 사용자가 "복사했습니다"에 체크해야만
  // 다음으로 넘어갈 수 있게 막습니다. 기존 CSS 파일을 건드리지 않으려고 인라인 스타일로 구성했습니다.
  function showRecoveryCodeModal(code) {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.setAttribute('role', 'dialog');
      overlay.setAttribute('aria-modal', 'true');
      overlay.setAttribute('aria-labelledby', 'recovery-code-title');
      overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;z-index:9999;padding:16px;';

      const dialog = document.createElement('div');
      dialog.style.cssText = 'background:#fff;border-radius:12px;max-width:360px;width:100%;padding:24px;text-align:center;';

      const title = document.createElement('h2');
      title.id = 'recovery-code-title';
      title.textContent = '복구 코드를 저장해주세요';
      title.style.cssText = 'margin:0 0 8px;font-size:18px;';

      const desc = document.createElement('p');
      desc.textContent = '비밀번호를 잊었을 때 필요한 코드입니다. 이 창을 닫으면 다시 볼 수 없습니다.';
      desc.style.cssText = 'margin:0 0 16px;font-size:14px;color:#555;';

      const codeBox = document.createElement('code');
      codeBox.textContent = code;
      codeBox.style.cssText = 'display:block;font-size:18px;font-weight:700;letter-spacing:.05em;background:#f4f4f5;border-radius:8px;padding:12px;margin-bottom:16px;user-select:all;';

      const label = document.createElement('label');
      label.style.cssText = 'display:flex;align-items:center;gap:8px;justify-content:center;margin-bottom:16px;font-size:14px;cursor:pointer;';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      label.append(checkbox, document.createTextNode('복사했습니다'));

      const confirmButton = document.createElement('button');
      confirmButton.type = 'button';
      confirmButton.textContent = '확인';
      confirmButton.disabled = true;
      confirmButton.style.cssText = 'width:100%;padding:12px;border:none;border-radius:8px;background:#111;color:#fff;font-weight:600;cursor:not-allowed;opacity:.5;';

      checkbox.addEventListener('change', () => {
        confirmButton.disabled = !checkbox.checked;
        confirmButton.style.cursor = checkbox.checked ? 'pointer' : 'not-allowed';
        confirmButton.style.opacity = checkbox.checked ? '1' : '.5';
      });
      confirmButton.addEventListener('click', () => {
        if (confirmButton.disabled) return;
        overlay.remove();
        resolve();
      });

      dialog.append(title, desc, codeBox, label, confirmButton);
      overlay.appendChild(dialog);
      document.body.appendChild(overlay);
    });
  }

  // [닉네임 중복 확인] 선택 API가 구현되면 같은 버튼이 실제 서버 중복 검사로 자동 전환됩니다.
  nicknameCheckButton.addEventListener('click', async () => {
    try {
      const result = await window.AuthService.checkNicknameAvailability(nicknameInput.value);
      showToast(result.available ? '사용 가능한 닉네임입니다.' : '이미 사용 중인 닉네임입니다.');
    } catch (error) {
      showToast(error.message);
    }
  });

  // [회원가입 제출] 닉네임·비밀번호를 API 계약과 같은 payload로 전달한 뒤 로그인 화면으로 이동합니다.
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
      signupForm.reset();
      document.querySelector('#signup-terms').checked = true;

      // ⚠️ 신규 추가: recoveryCode가 내려오면(Supabase 연동 시) 사용자가 확인할 때까지 다음으로 못 넘어가게 막습니다.
      if (result.recoveryCode) {
        await showRecoveryCodeModal(result.recoveryCode);
      }

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
