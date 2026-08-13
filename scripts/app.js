// [앱 초기화] 안내 메시지와 컨셉 소개 진입만 담당하는 최상위 초기화 파일입니다.
(() => {
  const toast = document.querySelector('#toast');
  let toastTimer;

  function showToast(message) {
    toast.textContent = message;
    toast.classList.add('is-visible');
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toast.classList.remove('is-visible'), 2400);
  }

  // 아직 실제 기능과 연결되지 않은 버튼은 현재 단계의 안내만 보여줍니다.
  document.querySelectorAll('[data-toast]').forEach((button) => {
    button.addEventListener('click', () => showToast(button.dataset.toast));
  });

  document.querySelector('#order-button').addEventListener('click', () => {
    showToast('주문 내용을 확인했습니다. 실제 포인트 거래 기능은 다음 단계에서 연결됩니다.');
  });

  // localStorage에 완료 기록이 없을 때만 최초 진입 컨셉 소개를 표시합니다.
  // [로그인 복원] 백엔드가 /auth/me를 제공하면 새로고침 후에도 닉네임·포인트·투자 내역을 복원합니다.
  window.AuthService?.restoreSession?.();

  window.ConceptIntroduction.start();
})();
