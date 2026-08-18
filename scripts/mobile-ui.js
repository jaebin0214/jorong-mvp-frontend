// [모바일 UI] 기존 서비스·투자·댓글 로직을 유지한 채 작은 화면의 보조 화면만 연결합니다.
(() => {
  const mobileQuery = window.matchMedia('(max-width: 767px)');
  const landingTimer = document.querySelector('#mobile-landing-countdown');
  const landingTimerLabel = document.querySelector('#mobile-landing-countdown-label');
  const landingTimerCard = document.querySelector('.mobile-landing-timer');
  const bottomNav = document.querySelector('#mobile-bottom-nav');
  const roastCta = document.querySelector('#exchange-roast-cta');
  const investmentSheet = document.querySelector('.exchange-roast-card');
  const investmentSheetTrigger = document.querySelector('#mobile-investment-sheet-trigger');
  const investmentSheetTitle = document.querySelector('#mobile-investment-sheet-title');
  const investmentSheetHint = document.querySelector('#mobile-investment-sheet-hint');
  const mobileQuickAmountButtons = document.querySelectorAll('[data-mobile-investment-quick]');
  const firstInvestmentAmount = document.querySelector('#investment-amount');
  const investmentBalance = document.querySelector('#investment-balance');
  const firstInvestmentPanel = document.querySelector('#investment-panel');
  const positionInvestmentPanel = document.querySelector('#investment-status-card');
  const additionalInvestmentPanel = document.querySelector('#additional-investment-panel');
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

  if (!landingTimer || !bottomNav || !composer || !desktopCommentForm || !desktopCommentInput || !composerForm || !composerInput || !investmentSheet || !investmentSheetTrigger) return;

  function isMobile() {
    return mobileQuery.matches;
  }

  // [투자 시트 상태] 기존 투자 UI가 어떤 패널을 열었는지 읽어, 모바일 하단 도크의 문구만 동기화합니다.
  function getInvestmentPanelState() {
    if (!roastCta.hidden) return 'LOCKED';
    if (additionalInvestmentPanel && !additionalInvestmentPanel.hidden) return 'ADDITIONAL_INVESTMENT';
    if (positionInvestmentPanel && !positionInvestmentPanel.hidden) return 'POSITION';
    if (firstInvestmentPanel && !firstInvestmentPanel.hidden) return 'FIRST_INVESTMENT';
    return 'NONE';
  }

  function isInvestmentSheetOpen() {
    return investmentSheet.classList.contains('is-mobile-investment-sheet-open');
  }

  function closeInvestmentSheet() {
    investmentSheet.classList.remove('is-mobile-investment-sheet-open');
    document.body.classList.remove('is-mobile-investment-sheet-open');
    investmentSheetTrigger.setAttribute('aria-expanded', 'false');
  }

  function syncInvestmentSheetDock() {
    const panelState = getInvestmentPanelState();
    const label = {
      LOCKED: ['조롱을 남기고 투자하기', '댓글 작성 →'],
      FIRST_INVESTMENT: ['투자하기', '위로 올려보기'],
      POSITION: ['내 투자 현황', '위로 올려보기'],
      ADDITIONAL_INVESTMENT: ['추가 투자하기', '위로 올려보기'],
      NONE: ['투자하기', '거래 정보를 확인 중입니다'],
    }[panelState];
    if (investmentSheetTitle) investmentSheetTitle.textContent = label[0];
    if (investmentSheetHint) investmentSheetHint.textContent = label[1];
    investmentSheetTrigger.setAttribute('aria-label', panelState === 'LOCKED' ? '댓글을 작성하고 투자하기' : `${label[0]} 열기`);
    // 다른 계정으로 바뀌거나 댓글 권한이 사라져 잠금 상태가 되면 열린 시트도 즉시 접습니다.
    if (panelState === 'LOCKED' || !isMobile()) closeInvestmentSheet();
  }

  // [하단 도크 열기] 잠긴 상태는 기존 댓글 작성 흐름으로, 열린 상태는 기존 투자 패널을 바텀시트로 표시합니다.
  function openInvestmentSheet() {
    if (!isMobile() || window.MarketCountdown?.isEnded?.()) return;
    const panelState = getInvestmentPanelState();
    if (panelState === 'LOCKED') {
      roastCta.click();
      return;
    }
    if (panelState === 'NONE') window.InvestmentUI?.open?.();
    if (getInvestmentPanelState() === 'LOCKED') return;
    investmentSheet.classList.add('is-mobile-investment-sheet-open');
    document.body.classList.add('is-mobile-investment-sheet-open');
    investmentSheetTrigger.setAttribute('aria-expanded', 'true');
  }

  function toggleInvestmentSheet() {
    if (isInvestmentSheetOpen()) closeInvestmentSheet();
    else openInvestmentSheet();
  }

  // [스와이프 제스처] 도크를 위로 밀면 열리고, 시트 상단 손잡이를 아래로 밀면 다시 접힙니다.
  function bindVerticalSwipe(element, { onSwipeUp, onSwipeDown }) {
    let startY = null;
    element.addEventListener('touchstart', (event) => { startY = event.touches[0]?.clientY ?? null; }, { passive: true });
    element.addEventListener('touchend', (event) => {
      const endY = event.changedTouches[0]?.clientY;
      if (!Number.isFinite(startY) || !Number.isFinite(endY)) return;
      const distance = endY - startY;
      startY = null;
      if (distance <= -28) onSwipeUp?.();
      if (distance >= 28) onSwipeDown?.();
    }, { passive: true });
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
    const state = window.CommentService?.getCommentingState?.();
    if (!isMobile() || (state && !state.isOpen) || window.MarketCountdown?.isEnded?.()) return;
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

  // [잠긴 투자 카드] 다른 사용자의 댓글 수와 무관하게 현재 사용자가 잠겨 있으면 작성 화면으로 보냅니다.
  function handleRoastCta(event) {
    if (!isMobile()) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (!roastCta.hidden || shouldWriteFirstComment()) {
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

  investmentSheetTrigger.addEventListener('click', toggleInvestmentSheet);
  investmentSheetTrigger.addEventListener('wheel', (event) => { if (event.deltaY < -8) openInvestmentSheet(); }, { passive: true });
  bindVerticalSwipe(investmentSheetTrigger, { onSwipeUp: openInvestmentSheet });
  investmentSheet.querySelectorAll('.mobile-investment-sheet-handle').forEach((handle) => {
    handle.addEventListener('click', closeInvestmentSheet);
    bindVerticalSwipe(handle, { onSwipeDown: closeInvestmentSheet });
  });

  // [빠른 금액 선택] Figma 시트의 비율 버튼도 기존 입력창의 input 이벤트를 발생시켜
  // InvestmentUI가 가진 잔액 한도 검증·금액 포맷을 그대로 재사용합니다.
  mobileQuickAmountButtons.forEach((button) => {
    button.addEventListener('click', () => {
      if (!firstInvestmentAmount) return;
      const ratio = Number(button.dataset.mobileInvestmentQuick);
      const balance = Number(String(investmentBalance?.textContent || '').replace(/[^0-9]/g, ''));
      if (!Number.isFinite(ratio) || !Number.isFinite(balance)) return;
      firstInvestmentAmount.value = String(Math.floor(balance * ratio / 100));
      firstInvestmentAmount.dispatchEvent(new Event('input', { bubbles: true }));
      firstInvestmentAmount.dispatchEvent(new Event('blur', { bubbles: true }));
    });
  });

  composerForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const state = window.CommentService?.getCommentingState?.();
    if (state && !state.isOpen) {
      closeComposer();
      return;
    }
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
    if (event.key !== 'Escape') return;
    if (!composer.hidden) closeComposer();
    else if (isInvestmentSheetOpen()) closeInvestmentSheet();
  });
  window.addEventListener('jorong:view-changed', (event) => {
    const viewId = event.detail?.viewId;
    syncBottomNavigation(viewId);
    if (viewId !== 'exchange') closeInvestmentSheet();
  });
  window.addEventListener('jorong:market-clock-synced', renderLandingTimer);
  window.addEventListener('jorong:market-ended', renderLandingTimer);
  window.addEventListener('jorong:market-config-updated', (event) => setMobileSubjectName(event.detail?.subject?.name));
  window.addEventListener('jorong:investment-panel-changed', syncInvestmentSheetDock);

  function syncResponsiveState() {
    if (!isMobile() && !composer.hidden) closeComposer();
    if (!isMobile()) closeInvestmentSheet();
    syncInvestmentSheetDock();
    renderLandingTimer();
  }

  mobileQuery.addEventListener?.('change', syncResponsiveState);
  setMobileSubjectName();
  syncBottomNavigation(document.querySelector('.view.is-active')?.id || 'landing');
  syncInvestmentSheetDock();
  renderLandingTimer();
  timerId = window.setInterval(renderLandingTimer, 1000);

  window.MobileUI = Object.freeze({
    openCommentComposer: openComposer,
    closeCommentComposer: closeComposer,
    openInvestmentSheet,
    closeInvestmentSheet,
    setSubjectName: setMobileSubjectName,
    stop: () => { if (timerId) window.clearInterval(timerId); },
  });
})();
