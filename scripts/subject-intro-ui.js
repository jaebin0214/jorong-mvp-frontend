// [종목 소개 UI] 이번 방문에서 거래소를 처음 열면 종목 안내를 표시하고, 종목 이미지를 누르면 언제든 다시 열 수 있게 합니다.
(() => {
  const modal = document.querySelector('#subject-intro-modal');
  const dialog = document.querySelector('#subject-intro-dialog');
  const image = document.querySelector('#subject-intro-image');
  const name = document.querySelector('#subject-intro-name');
  const description = document.querySelector('#subject-intro-description');
  const startButton = document.querySelector('#subject-intro-start');
  const subjectImage = document.querySelector('.exchange-subject-image');
  const config = window.MarketConfig.get();
  let hasShownOnFirstExchangeEntry = false;
  let lastFocusedElement = null;

  if (!modal || !dialog || !startButton || !subjectImage) return;

  // [설정값 반영] 운영자가 market-config.js에서 바꾼 종목 이름·이미지·소개문을 모달에도 동일하게 표시합니다.
  function renderSubject() {
    const { subject } = config;
    image.src = subject.imagePath;
    image.alt = `${subject.name} 종목 이미지`;
    name.textContent = subject.name;
    description.textContent = subject.description;
  }

  function open(opener = document.activeElement) {
    renderSubject();
    lastFocusedElement = opener instanceof HTMLElement ? opener : null;
    modal.hidden = false;
    modal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('is-subject-intro-open');
    startButton.focus({ preventScroll: true });
  }

  function close() {
    modal.hidden = true;
    modal.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('is-subject-intro-open');
    lastFocusedElement?.focus?.({ preventScroll: true });
    // [다음 안내 연결] 회원가입 직후 대기 중인 인게임 튜토리얼이 있다면 종목 소개를 닫은 뒤 이어서 시작합니다.
    window.dispatchEvent(new CustomEvent('jorong:subject-intro-closed'));
  }

  // [첫 거래소 진입] 새로고침 기준 한 번만 자동 안내를 띄우며, 이후에는 종목 이미지 클릭으로 다시 확인합니다.
  window.addEventListener('jorong:view-changed', (event) => {
    if (event.detail?.viewId !== 'exchange' || hasShownOnFirstExchangeEntry) return;
    hasShownOnFirstExchangeEntry = true;
    open();
  });

  // [다시 보기] 기존 종목 이미지는 그대로 유지하고, 클릭 가능한 UI라는 점을 키보드와 마우스 모두에서 알립니다.
  subjectImage.tabIndex = 0;
  subjectImage.setAttribute('role', 'button');
  subjectImage.setAttribute('aria-label', '오늘의 종목 소개 다시 보기');
  subjectImage.addEventListener('click', () => open(subjectImage));
  subjectImage.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      open(subjectImage);
    }
  });

  startButton.addEventListener('click', close);
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !modal.hidden) close();
  });

  window.SubjectIntroUI = Object.freeze({ open, close });
})();
