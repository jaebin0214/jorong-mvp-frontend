// [정산 UI] 장 종료 이벤트를 받아 서버의 정산 결과를 렌더링하고 다음 장 시작 시간을 표시합니다.
(() => {
  const exchangeRebuild = document.querySelector('.exchange-rebuild');
  const settlementView = document.querySelector('#market-settlement-view');
  const resultCard = document.querySelector('#settlement-result-card');
  const math = window.FinancialMath;
  let activeMarket = null;
  let nextMarketTimerId = null;
  let settlementPollId = null;

  if (!exchangeRebuild || !settlementView || !resultCard || !math) return;

  function formatInvestment(value) {
    return math.formatKrwUnsigned(String(value || '0'), 0);
  }

  function formatPrice(value) {
    try { return math.formatPrice(value); } catch (_) { return '0 KRW'; }
  }

  function setText(selector, value) {
    const element = document.querySelector(selector);
    if (element) element.textContent = value;
  }

  function setHeaderBalance(points) {
    const label = document.querySelector('#exchange-header-balance');
    if (label && Number.isFinite(Number(points))) label.textContent = `${Math.round(Number(points)).toLocaleString('ko-KR')} KRW`;
  }

  function renderNextMarketCountdown() {
    const target = Date.parse(activeMarket?.nextOpenAt || window.MarketCountdown?.getNextOpenAt?.() || '');
    const timer = document.querySelector('#next-market-countdown');
    const label = document.querySelector('#next-market-open-label');
    if (!timer || !label) return;
    if (!Number.isFinite(target)) {
      timer.textContent = '--:--:--';
      label.textContent = '다음 장 오픈 시간을 확인 중입니다.';
      return;
    }
    const now = window.MarketCountdown?.getServerNow?.() || Date.now();
    const seconds = Math.max(0, Math.ceil((target - now) / 1000));
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const restSeconds = seconds % 60;
    timer.textContent = [hours, minutes, restSeconds].map((value) => String(value).padStart(2, '0')).join(':');
    const date = new Date(target);
    label.textContent = `다음 장 오픈 · ${date.toLocaleDateString('ko-KR', { month:'numeric', day:'numeric', weekday:'short' })} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  }

  function renderMarketSummary(summary = {}) {
    const supportRatio = Number(summary.supportRatio) || 0;
    const mockRatio = Number(summary.mockRatio) || 0;
    setText('#settlement-market-volume', `총 거래량 ${formatInvestment(summary.totalVolume)} · 참여 ${Number(summary.participants) || 0}명`);
    setText('#settlement-support-ratio', `옹호 ${supportRatio.toFixed(0)}%`);
    setText('#settlement-mock-ratio', `조롱 ${mockRatio.toFixed(0)}%`);
    document.querySelector('#settlement-support-bar').style.width = `${Math.max(0, Math.min(100, supportRatio))}%`;
    document.querySelector('#settlement-mock-bar').style.width = `${Math.max(0, Math.min(100, mockRatio))}%`;
  }

  function renderSettlement(snapshot) {
    const subject = window.MarketConfig.get().subject;
    const market = snapshot.market || {};
    const position = snapshot.position;
    const settlement = snapshot.settlement;
    activeMarket = market;
    document.querySelector('#settlement-subject-image').src = subject.imagePath;
    document.querySelector('#settlement-subject-image').alt = `오늘의 종목 ${subject.name}`;
    setText('#settlement-subject-name', `오늘의 종목 · ${subject.name}`);
    setText('#settlement-close-price', `마감 가격 ${formatPrice(market.closePrice ?? settlement?.closePrice ?? snapshot.target?.value)}`);
    setHeaderBalance(snapshot.wallet?.points);

    const hasSettlement = Boolean(settlement && position);
    document.querySelector('#settlement-empty').hidden = hasSettlement;
    resultCard.classList.toggle('is-empty', !hasSettlement);
    if (hasSettlement) {
      const pnl = settlement.realizedPnl ?? settlement.unrealizedPnl ?? '0';
      const rate = settlement.pnlRate ?? '0';
      const isProfit = !String(pnl).startsWith('-') && String(pnl) !== '0';
      const isLoss = String(pnl).startsWith('-');
      const outcome = isProfit ? '예측 성공' : isLoss ? '예측 실패' : '변동 없음';
      const outcomeElement = document.querySelector('#settlement-outcome');
      outcomeElement.textContent = outcome;
      outcomeElement.className = isProfit ? '' : isLoss ? 'is-failure' : 'is-neutral';
      const pnlElement = document.querySelector('#settlement-realized-pnl');
      pnlElement.textContent = `${math.formatKrw(pnl)} (${math.formatRate(rate)})`;
      pnlElement.classList.toggle('is-loss', isLoss);
      setText('#settlement-total-investment', formatInvestment(position.totalInvestment));
      setText('#settlement-average-price', formatPrice(position.averagePrice));
      setText('#settlement-final-price', formatPrice(settlement.closePrice ?? market.closePrice));
      setText('#settlement-quantity', math.formatQuantity(position.quantity));
      setText('#settlement-amount', math.formatKrwUnsigned(settlement.settlementAmount ?? '0'));
      setText('#settlement-balance-after', `정산 후 보유 · ${formatInvestment(settlement.balanceAfterSettlement ?? snapshot.wallet?.points ?? 0)}`);
    } else {
      setText('#settlement-outcome', '투자 내역 없음');
      document.querySelector('#settlement-outcome').className = 'is-neutral';
    }
    renderMarketSummary(snapshot.marketSummary || market.summary || {});
    renderNextMarketCountdown();
  }

  function showPending() {
    exchangeRebuild.hidden = true;
    settlementView.hidden = false;
    activeMarket = { nextOpenAt: window.MarketCountdown?.getNextOpenAt?.() };
    resultCard.classList.add('is-empty');
    setText('#settlement-outcome', '정산 처리 중');
    document.querySelector('#settlement-outcome').className = 'is-neutral';
    document.querySelector('#settlement-empty').hidden = false;
    document.querySelector('#settlement-empty').textContent = '서버가 정산 결과를 확정하고 있습니다. 잠시 후 다시 확인해주세요.';
    renderNextMarketCountdown();
  }

  // [정산 진입] API 연결 시에는 서버 결과를 읽고, 정적 MVP에서는 InvestmentService의 멱등 로컬 정산 결과를 읽습니다.
  async function show() {
    exchangeRebuild.hidden = true;
    settlementView.hidden = false;
    try {
      const snapshot = await window.InvestmentService.loadSettlement();
      renderSettlement(snapshot);
      if (settlementPollId) {
        window.clearInterval(settlementPollId);
        settlementPollId = null;
      }
    } catch (_) {
      showPending();
      // [비동기 정산 대기] 서버 배치가 아직 끝나지 않은 경우에만 결과를 짧게 다시 조회합니다.
      if ((window.JORONG_API_BASE_URL || '').trim() && !settlementPollId) {
        settlementPollId = window.setInterval(async () => {
          try {
            const snapshot = await window.InvestmentService.loadSettlement();
            renderSettlement(snapshot);
            window.clearInterval(settlementPollId);
            settlementPollId = null;
          } catch (_) { /* 정산 완료 전에는 대기 문구를 유지합니다. */ }
        }, 5_000);
      }
    }
    if (!nextMarketTimerId) nextMarketTimerId = window.setInterval(renderNextMarketCountdown, 1000);
  }

  window.MarketSettlementUI = Object.freeze({ show, renderSettlement });
})();
