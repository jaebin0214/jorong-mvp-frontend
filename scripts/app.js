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

  // [인증 우선 초기화] Edge처럼 저장소·복원 시점이 달라도 로그인 세션을 먼저 확인합니다.
  // 인증된 사용자는 컨셉 소개를 자동으로 보지 않으며, 비로그인 첫 방문자에게만 소개를 엽니다.
  (async () => {
    await window.AuthService?.restoreSession?.();
    const isLoggedIn = Boolean(window.AuthService?.getCurrentAccount?.());
    if (isLoggedIn) window.ConceptIntroduction?.complete?.();
    else window.ConceptIntroduction?.start?.();
  })();
})();
