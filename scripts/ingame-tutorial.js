// [인게임 튜토리얼] 회원가입 후 첫 로그인한 사용자에게 거래소의 핵심 기능을 단계별로 보여줍니다.
(() => {
  const PENDING_SIGNUP_KEY = 'jorong:ingame-tutorial-pending-signup';
  const layer = document.querySelector('#ingame-tutorial');
  const spotlight = document.querySelector('#ingame-tutorial-spotlight');
  const callout = document.querySelector('#ingame-tutorial-callout');
  const stepLabel = document.querySelector('#ingame-tutorial-step');
  const title = document.querySelector('#ingame-tutorial-title');
  const description = document.querySelector('#ingame-tutorial-description');
  const nextButton = document.querySelector('#ingame-tutorial-next');
  const skipButton = document.querySelector('#ingame-tutorial-skip');
  let activeStepIndex = 0;
  let queuedAccount = null;
  let isOpen = false;

  // [튜토리얼 단계] selector를 바꾸면 각 단계가 강조할 거래소 요소를 쉽게 교체할 수 있습니다.
  const steps = [
    {
      selector: '.exchange-countdown',
      title: '거래 시간 안에 참여하세요.',
      description: '상단 타이머가 0이 되면 오늘의 거래가 종료됩니다. 남은 시간 안에 조롱을 남기고 투자해보세요.',
      // [타이머 강조 여백] 타이머 위쪽 여백을 더 크게 두어 상단 안내 영역까지 자연스럽게 감쌉니다.
      spotlightInset: { top:28, right:16, bottom:15, left:16 },
    },
    {
      selector: '#exchange-comment-form',
      title: '먼저, 조롱을 작성해주세요.',
      description: '오늘의 종목에 대한 조롱을 남기면 투자 기능이 열립니다.',
    },
    {
      selector: '.exchange-roast-card',
      title: '옹호 또는 조롱을 선택해 투자하세요.',
      description: '원하는 방향과 금액을 선택하면 종목의 가치에 반영됩니다.',
    },
    {
      selector: '.exchange-chart-card',
      title: '가격 그래프로 시장 흐름을 확인하세요.',
      description: '사람들의 선택으로 달라지는 가격과 변동률을 실시간 그래프에서 확인할 수 있습니다.',
    },
  ];

  if (!layer || !spotlight || !callout || !stepLabel || !title || !description || !nextButton || !skipButton) return;

  function getPendingSignup() {
    try {
      const saved = sessionStorage.getItem(PENDING_SIGNUP_KEY);
      return saved ? JSON.parse(saved) : null;
    } catch (_) {
      sessionStorage.removeItem(PENDING_SIGNUP_KEY);
      return null;
    }
  }

  function matchesPendingAccount(account, pending) {
    if (!account || !pending) return false;
    if (pending.id && account.id) return pending.id === account.id;
    return pending.nickname === account.nickname;
  }

  // [회원가입 예약] 가입 성공 시에만 저장합니다. 백엔드 연결 뒤에는 로그인 응답의 needsIngameTutorial 값으로 대체할 수 있습니다.
  function scheduleAfterSignup(account) {
    if (!account?.nickname) return;
    sessionStorage.setItem(PENDING_SIGNUP_KEY, JSON.stringify({ id: account.id || '', nickname: account.nickname }));
  }

  function clearPendingSignup() {
    sessionStorage.removeItem(PENDING_SIGNUP_KEY);
    queuedAccount = null;
  }

  function getTarget() {
    return document.querySelector(steps[activeStepIndex]?.selector);
  }

  // [위치 계산] 화면을 벗어나지 않도록 타깃 아래를 우선하고, 공간이 부족하면 위에 안내 카드를 둡니다.
  function positionTutorial() {
    const target = getTarget();
    if (!target || !isOpen) return;

    const rect = target.getBoundingClientRect();
    const padding = 14;
    // [단계별 강조 범위] 기본 7px 여백을 쓰되, 타이머 단계처럼 별도 값을 정한 경우 그 값을 우선 적용합니다.
    const spotlightInset = { top:7, right:7, bottom:7, left:7, ...steps[activeStepIndex].spotlightInset };
    const spotlightTop = Math.max(padding, rect.top - spotlightInset.top);
    const spotlightLeft = Math.max(padding, rect.left - spotlightInset.left);
    const spotlightRight = Math.min(window.innerWidth - padding, rect.right + spotlightInset.right);
    const spotlightBottom = Math.min(window.innerHeight - padding, rect.bottom + spotlightInset.bottom);
    const spotlightWidth = Math.max(0, spotlightRight - spotlightLeft);
    const spotlightHeight = Math.max(0, spotlightBottom - spotlightTop);

    spotlight.style.top = `${spotlightTop}px`;
    spotlight.style.left = `${spotlightLeft}px`;
    spotlight.style.width = `${spotlightWidth}px`;
    spotlight.style.height = `${spotlightHeight}px`;

    const calloutRect = callout.getBoundingClientRect();
    const preferredLeft = rect.left + (rect.width / 2) - (calloutRect.width / 2);
    const left = Math.min(Math.max(padding, preferredLeft), window.innerWidth - calloutRect.width - padding);
    const belowTop = rect.bottom + 18;
    const aboveTop = rect.top - calloutRect.height - 18;
    const top = belowTop + calloutRect.height <= window.innerHeight - padding
      ? belowTop
      : Math.max(padding, aboveTop);

    callout.style.left = `${left}px`;
    callout.style.top = `${top}px`;
  }

  function renderStep() {
    const step = steps[activeStepIndex];
    const target = getTarget();
    if (!step || !target) {
      finish();
      return;
    }

    stepLabel.textContent = `${activeStepIndex + 1} / ${steps.length}`;
    title.textContent = step.title;
    description.textContent = step.description;
    nextButton.textContent = activeStepIndex === steps.length - 1 ? '거래 시작하기' : '다음';
    requestAnimationFrame(positionTutorial);
  }

  function open() {
    if (isOpen || !getTarget()) return;
    activeStepIndex = 0;
    isOpen = true;
    layer.hidden = false;
    layer.setAttribute('aria-hidden', 'false');
    document.body.classList.add('is-ingame-tutorial-open');
    renderStep();
    nextButton.focus({ preventScroll: true });
  }

  function finish() {
    if (!isOpen) return;
    isOpen = false;
    layer.hidden = true;
    layer.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('is-ingame-tutorial-open');
    clearPendingSignup();
  }

  function showNextStep() {
    if (!isOpen) return;
    if (activeStepIndex === steps.length - 1) {
      finish();
      return;
    }
    activeStepIndex += 1;
    renderStep();
  }

  // [회원가입 후 로그인] 종목 소개 모달이 먼저 열려 있으면, "거래 시작하기"를 누른 직후에 인게임 튜토리얼을 보여줍니다.
  function startAfterLogin(account) {
    const pending = getPendingSignup();
    if (!matchesPendingAccount(account, pending)) return false;
    queuedAccount = account;

    const subjectIntro = document.querySelector('#subject-intro-modal');
    if (subjectIntro && !subjectIntro.hidden) return true;
    open();
    return true;
  }

  nextButton.addEventListener('click', showNextStep);
  skipButton.addEventListener('click', finish);
  window.addEventListener('resize', positionTutorial);
  window.addEventListener('scroll', positionTutorial, { passive:true });
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && isOpen) finish();
  });

  // [종목 소개 종료 연결] 기존 종목 소개를 먼저 확인한 뒤 같은 거래소 화면에서 튜토리얼을 이어서 시작합니다.
  window.addEventListener('jorong:subject-intro-closed', () => {
    if (queuedAccount && matchesPendingAccount(queuedAccount, getPendingSignup())) open();
  });

  window.IngameTutorial = Object.freeze({ scheduleAfterSignup, startAfterLogin, open, finish });
})();
