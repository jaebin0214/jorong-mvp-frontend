// [투자 UI] 첫 투자, 고정 의견의 추가 투자, 내 투자 현황 카드를 InvestmentService 응답으로 렌더링합니다.
(() => {
  const roastCta = document.querySelector('#exchange-roast-cta');
  const firstPanel = document.querySelector('#investment-panel');
  const statusCard = document.querySelector('#investment-status-card');
  const additionalPanel = document.querySelector('#additional-investment-panel');
  const directionButtons = document.querySelectorAll('[data-investment-direction]');
  const firstAmountInput = document.querySelector('#investment-amount');
  const firstAmountButtons = document.querySelectorAll('[data-investment-amount]');
  const firstSubmitButton = document.querySelector('#investment-submit');
  const mobileInvestmentImpact = document.querySelector('#mobile-investment-impact');
  const additionalAmountInput = document.querySelector('#additional-investment-amount');
  const additionalAmountButtons = document.querySelectorAll('[data-additional-investment-amount]');
  const additionalSubmitButton = document.querySelector('#additional-investment-submit');
  const additionalCancelButton = document.querySelector('#additional-investment-cancel');
  const addInvestmentButton = document.querySelector('#position-add-investment');
  const balanceLabel = document.querySelector('#investment-balance');
  const additionalBalanceLabel = document.querySelector('#additional-investment-balance');
  const headerBalanceLabels = [...document.querySelectorAll('[data-header-balance]')];
  const toast = document.querySelector('#toast');
  const math = window.FinancialMath;
  let firstAmount = 5000;
  let additionalAmount = 5000;
  let selectedSide = null;
  let activeSnapshot = window.InvestmentService?.getSnapshot?.() || null;
  // [댓글 기반 투자 잠금] 투자 가능 여부는 화면에 남아 있는 전체 댓글 수가 아니라
  // 현재 로그인한 사용자가 이 회차에 남긴 원댓글을 기준으로 CommentsUI가 전달합니다.
  let hasCurrentUserRootComment = false;
  let isSubmitting = false;
  let toastTimer;
  let positionPnlFitFrame = null;
  // 계정 전환 중 이전 계정의 비동기 포트폴리오 응답이 늦게 돌아와 화면을 덮지 않게 합니다.
  let refreshSequence = 0;

  if (!roastCta || !firstPanel || !statusCard || !additionalPanel || !firstAmountInput || !additionalAmountInput || !math) return;

  function showToast(message) {
    toast.textContent = message;
    toast.classList.add('is-visible');
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toast.classList.remove('is-visible'), 2800);
  }

  function sideLabel(side) {
    return math.normalizeSide(side) === 'SUPPORT' ? '옹호' : '조롱';
  }

  function sideClass(side) {
    return math.normalizeSide(side) === 'SUPPORT' ? 'is-support' : 'is-mock';
  }

  function formatBalance(value) {
    return `${Math.max(0, Math.round(Number(value) || 0)).toLocaleString('ko-KR')} 크레딧`;
  }

  // [사용 가능 잔액] 투자 직후의 응답을 우선 사용하고, 화면 초기화 중에는 서비스의 최신 스냅샷을 보조로 사용합니다.
  function getAvailableBalance() {
    const snapshotPoints = Number(activeSnapshot?.wallet?.points);
    const servicePoints = Number(window.InvestmentService?.getSnapshot?.()?.wallet?.points);
    const points = Number.isFinite(snapshotPoints) ? snapshotPoints : servicePoints;
    return Number.isFinite(points) ? Math.max(0, Math.floor(points)) : 0;
  }

  // [프론트 잔액 한도] 버튼·직접 입력 모두 사용 가능 포인트를 넘지 않도록 같은 규칙으로 제한합니다.
  function clampAmountToAvailableBalance(value) {
    const amount = Math.max(0, Math.floor(Number(value) || 0));
    return Math.min(amount, getAvailableBalance());
  }

  function formatInvestment(value) {
    return math.formatCreditsUnsigned(String(value || '0'), 0);
  }

  function formatProfit(value) {
    return math.formatCredits(String(value || '0'));
  }

  // [손익 문구 맞춤] 카드 높이는 고정하고, 긴 손익·수익률 문자열만 한 줄 안에서 줄입니다.
  // CSS 기본 크기를 시작점으로 사용하므로 데스크톱·모바일 각각의 원래 글자 크기는 유지됩니다.
  function fitPositionPnlText() {
    const pnl = document.querySelector('#position-pnl');
    if (!pnl || statusCard.hidden || pnl.clientWidth <= 0) return;

    pnl.style.removeProperty('font-size');
    const maximumSize = Number.parseFloat(window.getComputedStyle(pnl).fontSize) || 20;
    const minimumSize = Math.min(12, maximumSize);
    let nextSize = maximumSize;

    // 0.5px 단위로 축소해, 숫자가 길어져도 버튼·카드를 밀어내지 않게 합니다.
    while (pnl.scrollWidth > pnl.clientWidth && nextSize > minimumSize) {
      nextSize = Math.max(minimumSize, nextSize - 0.5);
      pnl.style.fontSize = `${nextSize}px`;
    }

    pnl.classList.toggle('is-compact', nextSize < maximumSize);
  }

  function schedulePositionPnlFit() {
    if (positionPnlFitFrame != null) window.cancelAnimationFrame(positionPnlFitFrame);
    positionPnlFitFrame = window.requestAnimationFrame(() => {
      positionPnlFitFrame = null;
      fitPositionPnlText();
    });
  }

  function setVisiblePanel(panel) {
    const isInvestmentLocked = panel === roastCta;
    // [잠긴 투자 화면] 투자 입력 UI는 뒤에 그대로 보여주고, 댓글 작성 전에는 오버레이가 클릭을 받도록 합니다.
    roastCta.hidden = !isInvestmentLocked;
    firstPanel.hidden = panel !== firstPanel && !isInvestmentLocked;
    firstPanel.inert = isInvestmentLocked;
    firstPanel.setAttribute('aria-hidden', String(isInvestmentLocked));
    statusCard.hidden = panel !== statusCard;
    additionalPanel.hidden = panel !== additionalPanel;
    statusCard.parentElement.classList.toggle('has-open-position', panel === statusCard || panel === additionalPanel);
    // [모바일 바텀시트 동기화] 패널 종류만 알리고, 시트를 실제로 열지는 모바일 사용자의 탭·스와이프에 맡깁니다.
    const panelName = isInvestmentLocked ? 'LOCKED'
      : panel === firstPanel ? 'FIRST_INVESTMENT'
        : panel === statusCard ? 'POSITION'
          : panel === additionalPanel ? 'ADDITIONAL_INVESTMENT'
            : 'NONE';
    window.dispatchEvent(new CustomEvent('jorong:investment-panel-changed', { detail: { panel: panelName } }));
  }

  function renderFirstAmount() {
    firstAmount = clampAmountToAvailableBalance(firstAmount);
    firstAmountInput.value = firstAmount > 0 ? firstAmount.toLocaleString('ko-KR') : '';
    // [투자 실행 버튼] 금액은 입력란에서 읽고, 화면 크기와 무관하게 같은 실행 문구를 유지합니다.
    firstSubmitButton.textContent = '투자하기';
    if (mobileInvestmentImpact) mobileInvestmentImpact.textContent = '현재 가격으로 즉시 체결됩니다.';
  }

  function renderAdditionalAmount() {
    additionalAmount = clampAmountToAvailableBalance(additionalAmount);
    additionalAmountInput.value = additionalAmount > 0 ? additionalAmount.toLocaleString('ko-KR') : '';
    renderAdditionalPreview();
  }

  function renderBalance(points) {
    const availablePoints = Number.isFinite(Number(points)) ? Math.max(0, Math.floor(Number(points))) : getAvailableBalance();
    const display = formatBalance(availablePoints);
    balanceLabel.textContent = display;
    if (additionalBalanceLabel) additionalBalanceLabel.textContent = display;
    // 랜딩으로 돌아간 뒤에도 같은 최신 보유 크레딧이 보이도록 두 헤더를 함께 갱신합니다.
    if (window.HeaderAuthUI?.setBalance) window.HeaderAuthUI.setBalance(availablePoints);
    else headerBalanceLabels.forEach((label) => { label.textContent = display; });
    // 주문 완료 또는 잔액 동기화 뒤, 입력된 금액도 새 잔액을 넘지 않게 즉시 보정합니다.
    firstAmount = Math.min(firstAmount, availablePoints);
    additionalAmount = Math.min(additionalAmount, availablePoints);
  }

  // [첫 의견 선택] 첫 주문에서만 옹호/조롱을 바꿀 수 있으며, 추가 투자 화면에는 이 선택지가 없습니다.
  function selectSide(button) {
    directionButtons.forEach((candidate) => {
      const isSelected = candidate === button;
      candidate.classList.toggle('is-selected', isSelected);
      candidate.setAttribute('aria-pressed', String(isSelected));
    });
    selectedSide = button.dataset.investmentDirection === 'support' ? 'SUPPORT' : 'MOCK';
  }

  // [계정 전환 초기화] 이전 사용자의 방향 선택과 입력 화면을 새 세션에 남기지 않습니다.
  function resetFirstInvestmentForm() {
    selectedSide = null;
    directionButtons.forEach((button) => {
      button.classList.remove('is-selected');
      button.setAttribute('aria-pressed', 'false');
    });
  }

  // [포지션 렌더링] 주기 갱신 중에는 사용자가 열어 둔 추가 투자 입력창을 유지합니다.
  // 단, 첫 투자 완료·추가 투자 완료처럼 명시적으로 호출한 경우에는 투자 현황 카드로 돌아갑니다.
  function renderPosition(snapshot, { preserveAdditionalPanel = false } = {}) {
    const position = snapshot?.position;
    const metrics = snapshot?.positionMetrics;
    if (!position || position.status === 'SETTLED') return false;

    const side = math.normalizeSide(position.side);
    const sideBadge = document.querySelector('#position-side-badge');
    const currentPrice = document.querySelector('#position-current-price');
    const pnl = document.querySelector('#position-pnl');
    const total = document.querySelector('#position-total-investment');
    const average = document.querySelector('#position-average-price');
    const quantity = document.querySelector('#position-quantity');
    const estimated = document.querySelector('#position-estimated-value');
    const lockNote = document.querySelector('#position-lock-note');

    sideBadge.textContent = sideLabel(side);
    sideBadge.className = `position-side-badge ${sideClass(side)}`;
    currentPrice.textContent = math.formatPrice(metrics?.currentPrice ?? snapshot.target?.value ?? 0);
    pnl.textContent = `${formatProfit(metrics?.unrealizedPnl)} (${math.formatRate(metrics?.pnlRate || '0')})`;
    pnl.classList.toggle('is-profit', !String(metrics?.unrealizedPnl || '0').startsWith('-'));
    pnl.classList.toggle('is-loss', String(metrics?.unrealizedPnl || '0').startsWith('-'));
    total.textContent = formatInvestment(position.totalInvestment);
    average.textContent = math.formatPrice(position.averagePrice);
    quantity.textContent = math.formatQuantity(position.quantity);
    estimated.textContent = math.formatCreditsUnsigned(metrics?.estimatedSettlementAmount || '0');
    lockNote.innerHTML = `한 번 선택한 의견은 장 종료까지 변경할 수 없어요.<br />추가 투자는 선택한 ‘${sideLabel(side)}’에만 가능해요.`;
    addInvestmentButton.textContent = `${sideLabel(side)}에 추가 투자`;
    const isAdditionalPanelOpen = !additionalPanel.hidden;

    if (preserveAdditionalPanel && isAdditionalPanelOpen) {
      // 최신 현재가·보유금으로 예상 추가 수량만 다시 계산
      renderAdditionalPreview();
    } else {
      // 일반 갱신이나 투자 완료 뒤에는 투자현황 카드 표시
      setVisiblePanel(statusCard);
      schedulePositionPnlFit();
    }

    return true;
  }

  function renderAdditionalPreview() {
    const position = activeSnapshot?.position;
    if (!position) return;
    const currentPrice = activeSnapshot?.positionMetrics?.currentPrice ?? activeSnapshot?.target?.value;
    const priceLabel = document.querySelector('#additional-execution-price');
    const quantityLabel = document.querySelector('#additional-estimated-quantity');
    priceLabel.textContent = math.formatPrice(currentPrice);
    try {
      quantityLabel.textContent = math.formatQuantity(math.calculateAddedQuantity(Math.max(1, additionalAmount), currentPrice));
    } catch (_) {
      quantityLabel.textContent = '0.0000주';
    }
  }

  function openFirstInvestment() {
    if (window.MarketCountdown?.isEnded?.()) {
      showToast('거래가 종료되었습니다.');
      return;
    }
    if (renderPosition(activeSnapshot)) return;
    // 현재 계정이 직접 작성한 원댓글이 없으면 첫 주문을 열지 않습니다.
    if (!hasCurrentUserRootComment) {
      setVisiblePanel(roastCta);
      return;
    }
    setVisiblePanel(firstPanel);
  }

  function openAdditionalInvestment() {
    if (window.MarketCountdown?.isEnded?.()) {
      showToast('거래가 종료되었습니다.');
      return;
    }
    const position = activeSnapshot?.position;
    if (!position) return openFirstInvestment();
    document.querySelector('#additional-investment-side').textContent = sideLabel(position.side);
    // 첫 투자 후 남은 잔액보다 큰 기본 입력값은 남은 잔액으로 낮춥니다.
    additionalAmount = clampAmountToAvailableBalance(additionalAmount);
    renderAdditionalAmount();
    setVisiblePanel(additionalPanel);
    additionalAmountInput.focus({ preventScroll: true });
  }

  function parseInput(input) {
    const cleaned = input.value.replace(/[^0-9]/g, '');
    if (input.value !== cleaned) input.value = cleaned;
    return cleaned ? Number(cleaned) : 0;
  }

  function attachAmountInput(input, readAmount, writeAmount, render) {
    input.addEventListener('input', () => {
      const requestedAmount = parseInput(input);
      const allowedAmount = clampAmountToAvailableBalance(requestedAmount);
      // 숫자를 직접 입력해도 현재 보유 포인트보다 큰 값은 입력 즉시 한도로 제한합니다.
      if (requestedAmount !== allowedAmount) input.value = String(allowedAmount);
      writeAmount(allowedAmount);
      if (input === additionalAmountInput) renderAdditionalPreview();
    });
    input.addEventListener('focus', () => { input.value = readAmount() ? String(readAmount()) : ''; });
    input.addEventListener('blur', () => render());
  }

  async function submitInvestment({ side, amount, button }) {
    if (isSubmitting) return;
    if (window.MarketCountdown?.isEnded?.()) {
      showToast('거래가 종료되었습니다.');
      return;
    }
    // 잠금 카드가 일시적으로 가려진 상태여도 주문 자체는 현재 계정의 댓글 조건을 다시 확인합니다.
    if (!activeSnapshot?.position && !hasCurrentUserRootComment) {
      setVisiblePanel(roastCta);
      showToast('먼저 조롱 댓글을 작성해주세요.');
      return;
    }
    if (!Number.isSafeInteger(amount) || amount <= 0) {
      showToast('투자금은 1 크레딧 이상의 정수로 입력해주세요.');
      return;
    }
    const availableBalance = getAvailableBalance();
    if (amount > availableBalance) {
      showToast(`보유 포인트가 부족합니다. 현재 ${formatBalance(availableBalance)}까지 투자할 수 있어요.`);
      return;
    }

    isSubmitting = true;
    button.disabled = true;
    try {
      const result = await window.InvestmentService.createInvestment({
        targetId: window.InvestmentService.TARGET_ID,
        side,
        investmentAmount: amount,
      });
      activeSnapshot = result;
      renderBalance(result.wallet?.points);
      if (result.target?.value != null) window.TargetValueUI?.update(result.target);
      window.PriceChartUI?.recordInvestment(result);
      renderPosition(result);
      window.dispatchEvent(new CustomEvent('jorong:investment-created', { detail: result }));
      showToast(`${sideLabel(side)}에 ${amount.toLocaleString('ko-KR')} 크레딧을 투자했습니다.`);
    } catch (error) {
      showToast(error.message || '투자 요청을 처리하지 못했습니다.');
    } finally {
      isSubmitting = false;
      button.disabled = false;
    }
  }

  directionButtons.forEach((button) => button.addEventListener('click', () => selectSide(button)));
  firstAmountButtons.forEach((button) => button.addEventListener('click', () => {
    firstAmount = clampAmountToAvailableBalance(Math.max(1, firstAmount + Number(button.dataset.investmentAmount)));
    renderFirstAmount();
  }));
  additionalAmountButtons.forEach((button) => button.addEventListener('click', () => {
    additionalAmount = clampAmountToAvailableBalance(Math.max(1, additionalAmount + Number(button.dataset.additionalInvestmentAmount)));
    renderAdditionalAmount();
  }));
  attachAmountInput(firstAmountInput, () => firstAmount, (value) => { firstAmount = value; }, renderFirstAmount);
  attachAmountInput(additionalAmountInput, () => additionalAmount, (value) => { additionalAmount = value; }, renderAdditionalAmount);

  firstSubmitButton.addEventListener('click', () => {
    if (!selectedSide) return showToast('옹호 또는 조롱을 선택해주세요.');
    submitInvestment({ side: selectedSide, amount: firstAmount, button: firstSubmitButton });
  });
  addInvestmentButton.addEventListener('click', openAdditionalInvestment);
  additionalCancelButton.addEventListener('click', () => renderPosition(activeSnapshot));
  additionalSubmitButton.addEventListener('click', () => {
    const side = activeSnapshot?.position?.side;
    if (side) submitInvestment({ side, amount: additionalAmount, button: additionalSubmitButton });
  });

  async function refresh() {
    const sequence = ++refreshSequence;
    try {
      const result = await window.InvestmentService.loadPortfolio();
      // 로그인 계정이 바뀐 뒤 이전 계정의 응답이 도착한 경우에는 무시합니다.
      if (sequence !== refreshSequence) return;
      activeSnapshot = result;
      renderBalance(result.wallet?.points);
      if (result.target?.value != null) window.TargetValueUI?.update(result.target);
      // 포지션이 없는 새 계정은 이전 계정의 추가 투자 화면을 유지하지 않습니다.
      if (!renderPosition(result, { preserveAdditionalPanel: true })) {
        setVisiblePanel(hasCurrentUserRootComment ? firstPanel : roastCta);
      }
    } catch (_) {
      // 로그인 전 또는 서버 연결 전 오류는 기존 투자 시작 화면을 유지합니다.
    }
  }

  // [인증 세션 변경] 같은 브라우저에서 다른 계정으로 전환해도 이전 계정의 포지션·추가 투자 UI가
  // 보이지 않도록 즉시 잠근 뒤, 새 계정의 포트폴리오와 댓글 상태를 다시 불러옵니다.
  window.addEventListener('jorong:auth-session', (event) => {
    activeSnapshot = null;
    hasCurrentUserRootComment = false;
    resetFirstInvestmentForm();
    renderBalance(event.detail?.wallet?.points);
    setVisiblePanel(roastCta);
    refresh();
  });
  window.addEventListener('jorong:market-settled', (event) => {
    activeSnapshot = event.detail;
    renderBalance(event.detail?.wallet?.points);
  });
  // 창 너비가 바뀌어도 손익 문구가 다시 카드 폭에 맞도록 보정합니다.
  window.addEventListener('resize', schedulePositionPnlFit);

  renderFirstAmount();
  renderAdditionalAmount();
  renderBalance(activeSnapshot?.wallet?.points);
  // [초기 잠금 화면] 댓글 작성 전에도 투자 패널의 형태를 보여주고, 오버레이만 위에 올립니다.
  setVisiblePanel(roastCta);
  refresh();
  // [실시간 평가손익] Supabase 연결 시 다른 사용자의 주문으로 바뀐 현재가와 평가손익을 주기적으로 다시 받습니다.
  if (window.JorongSupabase) window.setInterval(refresh, 10_000);
  window.InvestmentUI = Object.freeze({
    open: openFirstInvestment,
    refresh,
    renderPosition,
    // CommentsUI는 댓글 목록을 새 계정 기준으로 불러올 때마다 이 값을 갱신합니다.
    setCommentUnlockState: (isUnlocked) => {
      hasCurrentUserRootComment = Boolean(isUnlocked);
      if (activeSnapshot?.position) return;

      // [최초 투자 열기] 현재 계정이 원댓글을 등록하는 즉시 잠금 레이어를 해제합니다.
      // CommentsUI의 목록 갱신과 비동기 순서가 달라도 최초 투자창으로 안정적으로 전환됩니다.
      setVisiblePanel(hasCurrentUserRootComment ? firstPanel : roastCta);
    },
  });
})();
