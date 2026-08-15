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
  const additionalAmountInput = document.querySelector('#additional-investment-amount');
  const additionalAmountButtons = document.querySelectorAll('[data-additional-investment-amount]');
  const additionalSubmitButton = document.querySelector('#additional-investment-submit');
  const additionalCancelButton = document.querySelector('#additional-investment-cancel');
  const addInvestmentButton = document.querySelector('#position-add-investment');
  const balanceLabel = document.querySelector('#investment-balance');
  const additionalBalanceLabel = document.querySelector('#additional-investment-balance');
  const headerBalanceLabel = document.querySelector('#exchange-header-balance');
  const toast = document.querySelector('#toast');
  const math = window.FinancialMath;
  let firstAmount = 5000;
  let additionalAmount = 5000;
  let selectedSide = null;
  let activeSnapshot = window.InvestmentService?.getSnapshot?.() || null;
  let isSubmitting = false;
  let toastTimer;

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
    return `${Math.max(0, Math.round(Number(value) || 0)).toLocaleString('ko-KR')} KRW`;
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
    return math.formatKrwUnsigned(String(value || '0'), 0);
  }

  function formatProfit(value) {
    return math.formatKrw(String(value || '0'));
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
  }

  function renderFirstAmount() {
    firstAmount = clampAmountToAvailableBalance(firstAmount);
    firstAmountInput.value = firstAmount > 0 ? firstAmount.toLocaleString('ko-KR') : '';
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
    if (headerBalanceLabel) headerBalanceLabel.textContent = display;
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

  function renderPosition(snapshot) {
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
    estimated.textContent = math.formatKrwUnsigned(metrics?.estimatedSettlementAmount || '0');
    lockNote.innerHTML = `한 번 선택한 의견은 장 종료까지 변경할 수 없어요.<br />추가 투자는 선택한 ‘${sideLabel(side)}’에만 가능해요.`;
    addInvestmentButton.textContent = `${sideLabel(side)}에 추가 투자`;
    setVisiblePanel(statusCard);
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
    if (!Number.isSafeInteger(amount) || amount <= 0) {
      showToast('투자금은 1 KRW 이상의 정수로 입력해주세요.');
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
      showToast(`${sideLabel(side)}에 ${amount.toLocaleString('ko-KR')} KRW를 투자했습니다.`);
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
    try {
      const result = await window.InvestmentService.loadPortfolio();
      activeSnapshot = result;
      renderBalance(result.wallet?.points);
      if (result.target?.value != null) window.TargetValueUI?.update(result.target);
      renderPosition(result);
    } catch (_) {
      // 로그인 전 또는 서버 연결 전 오류는 기존 투자 시작 화면을 유지합니다.
    }
  }

  window.addEventListener('jorong:auth-session', () => refresh());
  window.addEventListener('jorong:market-settled', (event) => {
    activeSnapshot = event.detail;
    renderBalance(event.detail?.wallet?.points);
  });

  renderFirstAmount();
  renderAdditionalAmount();
  renderBalance(activeSnapshot?.wallet?.points);
  // [초기 잠금 화면] 댓글 작성 전에도 투자 패널의 형태를 보여주고, 오버레이만 위에 올립니다.
  setVisiblePanel(roastCta);
  refresh();
  // [실시간 평가손익] 서버 연결 시 다른 사용자의 주문으로 바뀐 현재가와 평가손익을 주기적으로 다시 받습니다.
  if ((window.JORONG_API_BASE_URL || '').trim()) window.setInterval(refresh, 10_000);
  window.InvestmentUI = Object.freeze({ open: openFirstInvestment, refresh, renderPosition });
})();
