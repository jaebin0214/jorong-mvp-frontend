// [모바일 UI] 기존 서비스·투자·댓글 로직을 유지한 채 작은 화면의 보조 화면만 연결합니다.
(() => {
  const mobileQuery = window.matchMedia('(max-width: 767px)');
  const landingTimer = document.querySelector('#mobile-landing-countdown');
  const landingTimerLabel = document.querySelector('#mobile-landing-countdown-label');
  const landingTimerCard = document.querySelector('.mobile-landing-timer');
  const bottomNav = document.querySelector('#mobile-bottom-nav');
  const roastCta = document.querySelector('#exchange-roast-cta');
  const commentEmpty = document.querySelector('#exchange-comment-empty');
  const desktopCommentForm = document.querySelector('#exchange-comment-form');
  const desktopCommentInput = document.querySelector('#exchange-comment-text');
  const composer = document.querySelector('#mobile-comment-composer');
  const composerOpen = document.querySelector('#mobile-community-compose');
  const composerClose = document.querySelector('#mobile-comment-composer-close');
  const composerForm = document.querySelector('#mobile-comment-form');
  const composerInput = document.querySelector('#mobile-comment-text');
  const composerLength = document.querySelector('#mobile-comment-length');
  const mobileSubjectName = document.querySelector('#mobile-subject-name');
  const mobileComposerSubjectName = document.querySelector('#mobile-comment-subject-name');
  let timerId = null;
  let priorFocus = null;

  if (!landingTimer || !bottomNav || !composer || !desktopCommentForm || !desktopCommentInput || !composerForm || !composerInput) return;

  function isMobile() {
    return mobileQuery.matches;
  }

  // [동일 서버 시각] 데스크톱 타이머가 가진 closeAt/nextOpenAt과 서버 보정 시각을 그대로 사용합니다.
  function renderLandingTimer() {
    if (!isMobile()) return;
    const countdown = window.MarketCountdown;
    if (!countdown?.isReady?.()) {
      landingTimer.textContent = '--:--:--';
      return;
    }
    const ended = countdown.isEnded?.();
    const targetTime = ended ? countdown.getNextOpenAt?.() : countdown.getEndAt?.();
    if (!Number.isFinite(targetTime)) {
      landingTimer.textContent = '--:--:--';
      return;
    }
    const seconds = Math.max(0, Math.ceil((targetTime - (countdown.getServerNow?.() || Date.now())) / 1000));
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const restSeconds = seconds % 60;
    landingTimer.textContent = [hours, minutes, restSeconds].map((value) => String(value).padStart(2, '0')).join(':');
    landingTimerLabel.textContent = ended ? '다음 장 시작까지' : '오늘의 장 마감까지';
    landingTimerCard.classList.toggle('is-next-market', Boolean(ended));
  }

  // [하단 탭 활성화] Navigation의 화면 전환 이벤트를 구독해 데스크톱 탭과 같은 상태를 표시합니다.
  function syncBottomNavigation(viewId) {
    bottomNav.querySelectorAll('[data-view]').forEach((button) => {
      button.classList.toggle('is-active', button.dataset.view === viewId);
    });
  }

  function setMobileSubjectName(name) {
    const label = String(name || window.MarketConfig?.get?.().subject?.name || '오늘의 종목');
    if (mobileSubjectName) mobileSubjectName.textContent = label;
    if (mobileComposerSubjectName) mobileComposerSubjectName.textContent = label;
  }

  // [댓글 작성 레이어] 모바일 입력값을 기존 form으로 전달하므로 API/로컬 시연 저장 방식이 완전히 동일합니다.
  function openComposer(opener = document.activeElement) {
    if (!isMobile() || window.MarketCountdown?.isEnded?.()) return;
    priorFocus = opener instanceof HTMLElement ? opener : null;
    setMobileSubjectName();
    composer.hidden = false;
    document.body.classList.add('is-mobile-comment-composer-open');
    composerInput.focus({ preventScroll: true });
  }

  function closeComposer() {
    composer.hidden = true;
    composerInput.value = '';
    composerLength.textContent = '0';
    document.body.classList.remove('is-mobile-comment-composer-open');
    priorFocus?.focus?.({ preventScroll: true });
  }

  function shouldWriteFirstComment() {
    return Boolean(commentEmpty && !commentEmpty.hidden);
  }

  // [잠긴 투자 카드] 댓글이 없으면 작성 화면, 댓글이 있으면 기존 투자 UI를 엽니다.
  function handleRoastCta(event) {
    if (!isMobile()) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (shouldWriteFirstComment()) {
      openComposer(roastCta);
    } else {
      window.InvestmentUI?.open?.();
    }
  }

  roastCta?.addEventListener('click', handleRoastCta, true);
  roastCta?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') handleRoastCta(event);
  }, true);
  composerOpen?.addEventListener('click', () => openComposer(composerOpen));
  composerClose?.addEventListener('click', closeComposer);
  composerInput.addEventListener('input', () => { composerLength.textContent = String(composerInput.value.length); });

  composerForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const content = composerInput.value.trim();
    if (!content) {
      composerInput.focus();
      return;
    }
    desktopCommentInput.value = content;
    closeComposer();
    // 기존 CommentsUI submit 핸들러가 댓글 저장·목록 갱신·투자 패널 열기를 모두 처리합니다.
    desktopCommentForm.requestSubmit();
  });

  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !composer.hidden) closeComposer();
  });
  window.addEventListener('jorong:view-changed', (event) => syncBottomNavigation(event.detail?.viewId));
  window.addEventListener('jorong:market-clock-synced', renderLandingTimer);
  window.addEventListener('jorong:market-ended', renderLandingTimer);
  window.addEventListener('jorong:market-config-updated', (event) => setMobileSubjectName(event.detail?.subject?.name));

  function syncResponsiveState() {
    if (!isMobile() && !composer.hidden) closeComposer();
    renderLandingTimer();
  }

  mobileQuery.addEventListener?.('change', syncResponsiveState);
  setMobileSubjectName();
  syncBottomNavigation(document.querySelector('.view.is-active')?.id || 'landing');
  renderLandingTimer();
  timerId = window.setInterval(renderLandingTimer, 1000);

  window.MobileUI = Object.freeze({
    openCommentComposer: openComposer,
    closeCommentComposer: closeComposer,
    setSubjectName: setMobileSubjectName,
    stop: () => { if (timerId) window.clearInterval(timerId); },
  });
})();
