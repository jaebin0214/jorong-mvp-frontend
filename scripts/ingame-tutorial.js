// [인게임 튜토리얼] 회원가입 후 첫 로그인한 사용자에게 거래소의 핵심 기능을 단계별로 보여줍니다.
(() => {
  const PENDING_SIGNUP_KEY = 'jorong:ingame-tutorial-pending-signup';
  // [Edge 저장소 보완] 일부 Edge 환경에서 sessionStorage만 차단되는 경우를 대비한 영속 예약 키입니다.
  const PENDING_SIGNUP_FALLBACK_KEY = 'jorong:ingame-tutorial-pending-signup:fallback';
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
  // [저장소 대체] Edge에서 sessionStorage가 차단되어도 같은 화면의 가입→로그인 흐름은 유지합니다.
  let pendingSignupMemory = null;
  let startAfterLoginTimer = null;
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
      const saved = window.sessionStorage.getItem(PENDING_SIGNUP_KEY);
      if (saved) {
        const pending = JSON.parse(saved);
        pendingSignupMemory = pending;
        return pending;
      }
    } catch (_) {
      // Edge에서 sessionStorage 접근이 거절되면 아래 localStorage 및 메모리 예약을 계속 확인합니다.
    }

    try {
      const fallback = window.localStorage.getItem(PENDING_SIGNUP_FALLBACK_KEY);
      if (fallback) {
        const pending = JSON.parse(fallback);
        pendingSignupMemory = pending;
        return pending;
      }
    } catch (_) {
      // localStorage도 차단된 환경은 같은 페이지의 메모리 예약으로 동작합니다.
    }

    return pendingSignupMemory;
  }

  function matchesPendingAccount(account, pending) {
    if (!account || !pending) return false;
    if (pending.id && account.id) return pending.id === account.id;
    return pending.nickname === account.nickname;
  }

  // [회원가입 예약] 가입 성공 시에만 저장합니다. 백엔드 연결 뒤에는 로그인 응답의 needsIngameTutorial 값으로 대체할 수 있습니다.
  function scheduleAfterSignup(account) {
    if (!account?.nickname) return;
    pendingSignupMemory = { id: account.id || '', nickname: account.nickname };
    try { window.sessionStorage.setItem(PENDING_SIGNUP_KEY, JSON.stringify(pendingSignupMemory)); } catch (_) { /* Edge 저장소 차단 시 메모리 예약을 사용합니다. */ }
    try { window.localStorage.setItem(PENDING_SIGNUP_FALLBACK_KEY, JSON.stringify(pendingSignupMemory)); } catch (_) { /* no-op */ }
  }

  function clearPendingSignup() {
    pendingSignupMemory = null;
    try { window.sessionStorage.removeItem(PENDING_SIGNUP_KEY); } catch (_) { /* no-op */ }
    try { window.localStorage.removeItem(PENDING_SIGNUP_FALLBACK_KEY); } catch (_) { /* no-op */ }
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

  // [회원가입 후 로그인] 거래소 전환과 종목 소개 모달 렌더링이 끝난 뒤에 튜토리얼을 엽니다.
  // Edge에서는 화면 전환 직후 모달의 hidden 상태가 아직 반영되지 않는 경우가 있어, 다음 이벤트 루프에서 한 번 더 확인합니다.
  function startQueuedTutorial() {
    if (!queuedAccount || !matchesPendingAccount(queuedAccount, getPendingSignup())) return false;

    const subjectIntro = document.querySelector('#subject-intro-modal');
    if (subjectIntro && !subjectIntro.hidden) return true;
    open();
    return true;
  }

  function startAfterLogin(account) {
    const pending = getPendingSignup();
    if (!matchesPendingAccount(account, pending)) return false;
    queuedAccount = account;

    window.clearTimeout(startAfterLoginTimer);
    startAfterLoginTimer = window.setTimeout(() => {
      startAfterLoginTimer = null;
      startQueuedTutorial();
    }, 0);
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
    startQueuedTutorial();
  });

  window.IngameTutorial = Object.freeze({ scheduleAfterSignup, startAfterLogin, open, finish });
})();
