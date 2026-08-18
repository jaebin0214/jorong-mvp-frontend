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
  const autoShownStoragePrefix = 'jorong:subject-intro:auto-shown:v1';
  let hasOpenedInCurrentPage = false;
  let lastFocusedElement = null;

  if (!modal || !dialog || !startButton || !subjectImage) return;

  // [개장 중 전용] 예약·마감·정산 회차에는 종목 소개를 자동으로 띄우지 않습니다.
  // 서버 시계를 쓸 때는 타이머 동기화가 끝난 뒤에만 판정해, 이전 캐시 상태로 팝업이 열리는 것을 막습니다.
  function canShowSubjectIntro() {
    if (config.marketAvailable !== true) return false;
    // 로그인 세션을 복원하는 짧은 동안에는 guest 키로 "이미 봄"을 기록하지 않습니다.
    // 복원 완료 뒤 실제 계정 기준으로 해당 장의 첫 입장을 판정합니다.
    if (window.AuthService && window.AuthService.isSessionRestored?.() === false) return false;
    const configuredStatus = String(config.session.status || '').toUpperCase();
    if (!['OPEN', 'LIVE'].includes(configuredStatus)) return false;
    if (window.MarketCountdown?.isReady?.() === false) return false;

    const startAt = Date.parse(config.session.startsAt || '');
    const endAt = Number.isFinite(startAt)
      ? startAt + (Number(config.session.durationHours) * 60 * 60 * 1000)
      : NaN;
    const now = window.MarketCountdown?.getServerNow?.() || Date.now();
    if (!Number.isFinite(startAt) || !Number.isFinite(endAt) || now < startAt || now >= endAt) return false;

    const isMarketEnded = window.MarketCountdown?.isEnded?.() === true;
    const settlementView = document.querySelector('#market-settlement-view');
    return !isMarketEnded && Boolean(settlementView?.hidden ?? true);
  }

  // [회차별 최초 진입] 같은 사용자가 같은 장을 새로고침하거나 다른 탭으로 돌아와도
  // 이미 본 소개를 다시 열지 않습니다. 다음 시장은 ID가 달라 자동으로 새 안내 대상이 됩니다.
  function getAutoShownStorageKey() {
    const marketId = String(config.session?.id || 'unknown-market');
    const accountId = String(window.AuthService?.getCurrentAccount?.()?.id || 'guest');
    return `${autoShownStoragePrefix}:${marketId}:${accountId}`;
  }

  function hasSeenCurrentMarketIntro() {
    try { return window.localStorage.getItem(getAutoShownStorageKey()) === 'true'; } catch (_) { return false; }
  }

  function markCurrentMarketIntroSeen() {
    try { window.localStorage.setItem(getAutoShownStorageKey(), 'true'); } catch (_) { /* no-op */ }
  }

  function isExchangeActive() {
    return document.querySelector('#exchange')?.classList.contains('is-active') === true;
  }

  function openOnFirstMarketEntry() {
    if (hasOpenedInCurrentPage || hasSeenCurrentMarketIntro() || !canShowSubjectIntro()) return;
    hasOpenedInCurrentPage = true;
    markCurrentMarketIntroSeen();
    open();
  }

  // [설정값 반영] 운영자가 market-config.js에서 바꾼 종목 이름·이미지·소개문을 모달에도 동일하게 표시합니다.
  function renderSubject() {
    const { subject } = config;
    image.src = subject.imagePath;
    image.alt = `${subject.name} 종목 이미지`;
    name.textContent = subject.name;
    description.textContent = subject.description;
  }

  function open(opener = document.activeElement) {
    if (!canShowSubjectIntro()) return;
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

  // [첫 거래소 진입] 실제 개장 회차에서만 자동 안내를 열며, 이후에는 종목 이미지 클릭으로 다시 확인합니다.
  window.addEventListener('jorong:view-changed', (event) => {
    if (event.detail?.viewId === 'exchange') openOnFirstMarketEntry();
  });

  // 인증·서버 시계가 늦게 준비되는 경우에도, 거래소에 머무르는 동안 최초 안내를 정확히 한 번만 확인합니다.
  window.addEventListener('jorong:auth-session', () => { if (isExchangeActive()) openOnFirstMarketEntry(); });
  window.addEventListener('jorong:market-clock-synced', () => { if (isExchangeActive()) openOnFirstMarketEntry(); });

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

  window.SubjectIntroUI = Object.freeze({ open, close, canShow: canShowSubjectIntro });
})();
