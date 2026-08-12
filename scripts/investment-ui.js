// [투자 UI] 투자 방향과 금액을 입력받아 투자 서비스에 요청하고, 결과를 화면에 반영합니다.
(() => {
  const roastCta = document.querySelector('#exchange-roast-cta');
  const panel = document.querySelector('#investment-panel');
  const directionButtons = document.querySelectorAll('[data-investment-direction]');
  const amountButtons = document.querySelectorAll('[data-investment-amount]');
  const amountInput = document.querySelector('#investment-amount');
  const balanceLabel = document.querySelector('#investment-balance');
  const headerBalanceLabel = document.querySelector('#exchange-header-balance');
  const submitButton = document.querySelector('#investment-submit');
  const toast = document.querySelector('#toast');
  let amount = 5000;
  let balance = window.InvestmentService.getSnapshot().wallet.points;
  let selectedDirection = null;
  let isSubmitting = false;
  let toastTimer;

  // [금액 표시] 직접 입력한 값과 ±10원 버튼으로 바뀐 값을 같은 형식으로 화면에 반영합니다.
  function renderAmount() {
    amountInput.value = amount.toLocaleString('ko-KR');
  }

  function renderBalance() {
    balanceLabel.textContent = `${balance.toLocaleString('ko-KR')} KRW`;
    if (headerBalanceLabel) headerBalanceLabel.textContent = `${balance.toLocaleString('ko-KR')} KRW`;
  }

  // [로그인 세션 반영] 재로그인 또는 새로고침 후 서버가 돌려준 포인트를 투자창과 상단 잔액에 동시에 표시합니다.
  window.addEventListener('jorong:auth-session', (event) => {
    const points = Number(event.detail?.wallet?.points ?? event.detail?.account?.points);
    if (!Number.isFinite(points)) return;
    balance = points;
    renderBalance();
  });

  function showToast(message) {
    toast.textContent = message;
    toast.classList.add('is-visible');
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toast.classList.remove('is-visible'), 2400);
  }

  // 선택한 방향만 진한 색으로 표시하고, API 전송용 방향값을 보관합니다.
  function selectDirection(selectedButton) {
    directionButtons.forEach((button) => {
      const isSelected = button === selectedButton;
      button.classList.toggle('is-selected', isSelected);
      button.setAttribute('aria-pressed', String(isSelected));
    });

    selectedDirection = selectedButton.dataset.investmentDirection;
  }

  // 댓글 작성 뒤 안내 카드 대신 같은 위치의 투자 패널을 표시합니다.
  function open() {
    if (window.MarketCountdown?.isEnded()) {
      showToast('거래가 종료되었습니다.');
      return;
    }
    roastCta.hidden = true;
    panel.hidden = false;
  }

  directionButtons.forEach((button) => {
    button.addEventListener('click', () => selectDirection(button));
  });

  amountButtons.forEach((button) => {
    button.addEventListener('click', () => {
      amount = Math.max(10, (amount || 0) + Number(button.dataset.investmentAmount));
      renderAmount();
    });
  });

  // [직접 입력] 입력 중에는 숫자만 허용하고, 붙여넣기한 문자·기호도 즉시 제거합니다.
  amountInput.addEventListener('input', () => {
    const numericValue = amountInput.value.replace(/[^0-9]/g, '');
    if (amountInput.value !== numericValue) amountInput.value = numericValue;
    amount = numericValue ? Number(numericValue) : 0;
  });

  // [입력 시작] 화면 표시용 쉼표를 제거해 사용자가 숫자만 직접 편집하게 합니다.
  amountInput.addEventListener('focus', () => {
    amountInput.value = amount ? String(amount) : '';
  });

  // [입력 완료] 빈 값·10 KRW 미만은 최소 투자 금액으로 보정하고 쉼표 형식으로 다시 보여줍니다.
  amountInput.addEventListener('blur', () => {
    if (amount < 10) amount = 10;
    renderAmount();
  });

  // 요청 성공 시 서버가 돌려준 잔액과 항목 가치를 표시합니다.
  submitButton.addEventListener('click', async () => {
    if (window.MarketCountdown?.isEnded()) {
      showToast('거래가 종료되었습니다.');
      return;
    }
    if (!selectedDirection) {
      showToast('옹호 또는 조롱을 선택해주세요.');
      return;
    }

    if (isSubmitting) return;
    isSubmitting = true;
    submitButton.disabled = true;

    try {
      const result = await window.InvestmentService.createInvestment({
        targetId: window.InvestmentService.TARGET_ID,
        // [동적 세션] 서버 시계가 반환한 현재 시장 ID로 투자 로그를 저장합니다.
        marketSessionId: window.InvestmentService.getMarketSessionId(),
        side: selectedDirection === 'support' ? 'SUPPORT' : 'ROAST',
        amount,
      });

      balance = result.wallet.points;
      renderBalance();
      window.TargetValueUI.update(result.target);
      window.PriceChartUI.recordInvestment(result);
      // [투자 로그 이벤트] 마이페이지 등 다른 UI가 새 투자 내역을 다시 조회할 수 있도록 알립니다.
      window.dispatchEvent(new CustomEvent('jorong:investment-created', { detail: result }));
      showToast(`${selectedDirection === 'support' ? '옹호' : '조롱'}에 ${amount.toLocaleString('ko-KR')} KRW를 투자했습니다.`);
    } catch (error) {
      showToast(error.message || '투자 요청에 실패했습니다.');
    } finally {
      isSubmitting = false;
      submitButton.disabled = false;
    }
  });

  renderAmount();
  renderBalance();
  window.InvestmentUI = Object.freeze({ open });
})();
