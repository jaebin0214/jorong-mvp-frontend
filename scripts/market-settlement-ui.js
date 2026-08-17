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
      // 다음 장이 아직 없을 때도 정산 결과는 유지하고 타이머 안내만 바꿉니다.
      label.textContent = '예약된 종목이 없습니다.';
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
    // 투자 원장은 예약 전 생성됐을 수 있으므로, 다음 장 시각은 현재 운영 설정의 최신 값으로 보완합니다.
    activeMarket = {
      ...market,
      nextOpenAt: market.nextOpenAt || window.MarketConfig?.get?.().session?.nextOpenAt || null,
    };
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
    // 시장 종료 이벤트보다 늦게 초기화된 경우에도 개인 리포트 보관을 한 번 더 보장합니다.
    window.CycleReportService?.archiveSnapshot?.(snapshot);
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
    // 이 함수가 정산 화면을 여는 유일한 진입점입니다. 어떤 종료 경로(타이머·운영자 수동 종료·새로고침)에서도
    // 거래소 본문 대신 정산 화면만 보여줍니다.
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
      // [비동기 정산 대기] 서버 배치(settle_market)가 아직 끝나지 않은 경우에만 결과를 짧게 다시 조회합니다.
      if (window.JorongSupabase && !settlementPollId) {
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

  // [재접속 복원] 종료된 장을 새로고침해도 market-ended 이벤트를 기다리지 않고 즉시 정산창을 엽니다.
  // 첫 운영 전의 SCHEDULED 빈 상태에는 실행되지 않아 기존 대기 화면을 유지합니다.
  const configuredStatus = String(window.MarketConfig?.get?.().session?.status || '').toUpperCase();
  if (['CLOSED', 'SETTLED', 'ARCHIVED'].includes(configuredStatus)) {
    window.queueMicrotask ? window.queueMicrotask(show) : window.setTimeout(show, 0);
  }

  // 운영자 페이지에서 다음 종목을 예약한 직후, 새로고침 전에도 정산창의 타이머를 최신 예약으로 교체합니다.
  // 같은 사이트 주소의 다른 탭에서 변경될 때만 storage 이벤트가 전달되며, 그 외 환경은 브리지의 폴링 새로고침이 보완합니다.
  window.addEventListener('storage', (event) => {
    if (event.key !== 'jorong_admin_demo_v1' || settlementView.hidden) return;
    const latestNextOpenAt = window.LocalAdminMarketBridge?.getMarketConfigOverride?.()?.session?.nextOpenAt || null;
    activeMarket = { ...(activeMarket || {}), nextOpenAt: latestNextOpenAt };
    renderNextMarketCountdown();
  });

  // 새로고침 뒤 로컬 인증 세션이 복원된 다음에는 해당 사용자 원장을 다시 읽어 정산 정보가 빈 상태로 남지 않게 합니다.
  window.addEventListener('jorong:auth-session', (event) => {
    if (!event.detail?.account || !['CLOSED', 'SETTLED', 'ARCHIVED'].includes(configuredStatus)) return;
    show();
  });

  window.MarketSettlementUI = Object.freeze({ show, renderSettlement });
})();
