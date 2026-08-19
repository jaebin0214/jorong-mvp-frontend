// [정산 UI] 장 종료 이벤트를 받아 서버의 정산 결과를 렌더링하고 다음 장 시작 시간을 표시합니다.
(() => {
  const exchangeRebuild = document.querySelector('.exchange-rebuild');
  const settlementView = document.querySelector('#market-settlement-view');
  const resultCard = document.querySelector('#settlement-result-card');
  const exchangeView = document.querySelector('#exchange');
  const appShell = document.querySelector('.app-shell');
  const shareButton = document.querySelector('#settlement-share-button');
  const commentHistory = document.querySelector('#settlement-comment-history');
  const commentHistoryList = document.querySelector('#settlement-comment-list');
  const commentHistoryCount = document.querySelector('#settlement-comment-count');
  const commentHistoryEmpty = document.querySelector('#settlement-comment-empty');
  const toast = document.querySelector('#toast');
  const math = window.FinancialMath;
  let activeMarket = null;
  let nextMarketTimerId = null;
  let settlementPollId = null;
  let commentHistoryRequestId = 0;

  if (!exchangeRebuild || !settlementView || !resultCard || !math) return;

  function formatInvestment(value) {
    return math.formatCreditsUnsigned(String(value || '0'), 0);
  }

  function formatPrice(value) {
    try { return math.formatPrice(value); } catch (_) { return '0 크레딧'; }
  }

  function setText(selector, value) {
    const element = document.querySelector(selector);
    if (element) element.textContent = value;
  }

  function setHeaderBalance(points) {
    const label = document.querySelector('#exchange-header-balance');
    if (label && Number.isFinite(Number(points))) label.textContent = `${Math.round(Number(points)).toLocaleString('ko-KR')} 크레딧`;
  }

  // [모바일 정산 앱 바] 정산 화면이 실제로 열려 있는 동안에만 공통 헤더를 ‘정산 결과’ 상태로 바꿉니다.
  // 리포트·랜딩으로 이동하면 즉시 원래 헤더로 복원해 다른 화면의 탐색을 가리지 않습니다.
  function syncSettlementShellState() {
    const isVisibleInExchange = exchangeView?.classList.contains('is-active') && settlementView && !settlementView.hidden;
    appShell?.classList.toggle('is-market-settlement', Boolean(isVisibleInExchange));
  }

  function showToast(message) {
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add('is-visible');
    window.setTimeout(() => toast.classList.remove('is-visible'), 2400);
  }

  // [정산 결과 공유] 모바일 Web Share를 우선 사용하고, 지원하지 않는 브라우저에서는 클립보드 복사로 보완합니다.
  async function shareSettlementResult() {
    const subjectName = document.querySelector('#settlement-subject-name')?.textContent || '오늘의 종목';
    const realizedPnl = document.querySelector('#settlement-realized-pnl')?.textContent || '0 크레딧';
    const payout = document.querySelector('#settlement-amount')?.textContent || '0 크레딧';
    const text = `${subjectName}\n최종 실현손익 ${realizedPnl}\n정산 지급액 ${payout}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: '조롱 거래소 정산 결과', text });
        return;
      }
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        showToast('정산 결과를 클립보드에 복사했습니다.');
        return;
      }
      showToast('이 브라우저에서는 결과 공유를 지원하지 않습니다.');
    } catch (error) {
      // 사용자가 공유 창을 닫은 경우에는 실패 메시지를 다시 표시하지 않습니다.
      if (error?.name !== 'AbortError') showToast('정산 결과를 공유하지 못했습니다.');
    }
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

  // [시장 댓글 기록] 거래 중 댓글과 같은 렌더러를 읽기 전용으로 호출합니다.
  // 마감 시점의 정렬(베스트 HYPE 2개 → 나머지 오래된 순)과 답글 더보기 규칙도 그대로 유지됩니다.
  async function renderSettlementCommentHistory() {
    if (!commentHistory || !commentHistoryList || !commentHistoryCount || !commentHistoryEmpty) return;
    const requestId = ++commentHistoryRequestId;
    commentHistoryList.replaceChildren();
    commentHistoryCount.textContent = '댓글 0';
    commentHistoryEmpty.hidden = false;
    commentHistoryEmpty.textContent = '시장 댓글 기록을 불러오는 중입니다.';

    const renderReadOnlyHistory = window.CommentUI?.renderReadOnlyHistory;
    // market-settlement-ui가 comments-ui보다 먼저 로드되는 초기 진입은 아래 준비 이벤트에서 다시 시도합니다.
    if (typeof renderReadOnlyHistory !== 'function') return;

    try {
      const { count = 0 } = await renderReadOnlyHistory(commentHistoryList);
      if (requestId !== commentHistoryRequestId) return;
      commentHistoryCount.textContent = `댓글 ${count}`;
      commentHistoryEmpty.hidden = count > 0;
      if (!count) commentHistoryEmpty.textContent = '이 시장에 남겨진 댓글이 없습니다.';
    } catch (_) {
      if (requestId !== commentHistoryRequestId) return;
      commentHistoryEmpty.textContent = '시장 댓글 기록을 불러오지 못했습니다.';
    }
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
    // [종목 설명] 운영자가 등록한 상세 설명을 정산 결과에서도 함께 보여, 종료된 뒤에도
    // 어떤 종목이었는지 이미지·이름만으로 판단해야 하는 상황을 없앱니다.
    setText('#settlement-subject-description', subject.description || '등록된 종목 설명이 없습니다.');
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
      pnlElement.textContent = `${math.formatCredits(pnl)} (${math.formatRate(rate)})`;
      pnlElement.classList.toggle('is-loss', isLoss);
      setText('#settlement-total-investment', formatInvestment(position.totalInvestment));
      setText('#settlement-average-price', formatPrice(position.averagePrice));
      setText('#settlement-final-price', formatPrice(settlement.closePrice ?? market.closePrice));
      setText('#settlement-quantity', math.formatQuantity(position.quantity));
      setText('#settlement-amount', math.formatCreditsUnsigned(settlement.settlementAmount ?? '0'));
      setText('#settlement-balance-after', `정산 후 보유 · ${formatInvestment(settlement.balanceAfterSettlement ?? snapshot.wallet?.points ?? 0)}`);
    } else {
      setText('#settlement-outcome', '투자 내역 없음');
      document.querySelector('#settlement-outcome').className = 'is-neutral';
    }
    renderMarketSummary(snapshot.marketSummary || market.summary || {});
    renderNextMarketCountdown();
    renderSettlementCommentHistory();
    // 시장 종료 이벤트보다 늦게 초기화된 경우에도 개인 리포트 보관을 한 번 더 보장합니다.
    window.CycleReportService?.archiveSnapshot?.(snapshot);
  }

  function showPending() {
    exchangeRebuild.hidden = true;
    settlementView.hidden = false;
    syncSettlementShellState();
    activeMarket = { nextOpenAt: window.MarketCountdown?.getNextOpenAt?.() };
    resultCard.classList.add('is-empty');
    setText('#settlement-outcome', '정산 처리 중');
    document.querySelector('#settlement-outcome').className = 'is-neutral';
    document.querySelector('#settlement-empty').hidden = false;
    document.querySelector('#settlement-empty').textContent = '서버가 정산 결과를 확정하고 있습니다. 잠시 후 다시 확인해주세요.';
    renderNextMarketCountdown();
  }

  // [정산 화면 노출] 타이머 종료·운영자 수동 종료·서버 정산 완료가 어떤 순서로 오더라도
  // 거래 본문을 확실히 숨기고 같은 정산 화면으로 수렴시키는 공통 진입 처리입니다.
  function revealSettlementView() {
    exchangeRebuild.hidden = true;
    settlementView.hidden = false;
    syncSettlementShellState();
    if (!nextMarketTimerId) nextMarketTimerId = window.setInterval(renderNextMarketCountdown, 1000);
  }

  // [정산 진입] API 연결 시에는 서버 결과를 읽고, 정적 MVP에서는 InvestmentService의 멱등 로컬 정산 결과를 읽습니다.
  async function show() {
    // 이 함수가 정산 화면을 여는 유일한 진입점입니다. 어떤 종료 경로(타이머·운영자 수동 종료·새로고침)에서도
    // 거래소 본문 대신 정산 화면만 보여줍니다.
    revealSettlementView();
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
  }

  // [재접속 복원] 종료된 장을 새로고침해도 market-ended 이벤트를 기다리지 않고 즉시 정산창을 엽니다.
  // 첫 운영 전의 SCHEDULED 빈 상태에는 실행되지 않아 기존 대기 화면을 유지합니다.
  const configuredStatus = String(window.MarketConfig?.get?.().session?.status || '').toUpperCase();
  if (['CLOSED', 'SETTLED', 'ARCHIVED'].includes(configuredStatus) || window.MarketCountdown?.isEnded?.()) {
    window.queueMicrotask ? window.queueMicrotask(show) : window.setTimeout(show, 0);
  }

  // [종료 이벤트 직접 수신] 기존 종료 오버레이 모듈의 로딩 순서에 의존하지 않습니다.
  // 로컬 시연은 InvestmentService가 market-settled와 함께 스냅샷을 보내고,
  // API 연결 환경은 market-ended 이후 서버 정산 결과를 show()에서 조회합니다.
  window.addEventListener('jorong:market-ended', () => { show(); });
  window.addEventListener('jorong:market-settled', (event) => {
    revealSettlementView();
    if (event.detail) renderSettlement(event.detail);
    else show();
  });
  // 댓글 UI가 나중에 초기화되는 첫 정산 진입도 읽기 전용 기록을 채웁니다.
  window.addEventListener('jorong:comment-ui-ready', () => {
    if (!settlementView.hidden) renderSettlementCommentHistory();
  });
  // 로컬 시연에서 댓글 상태가 변경된 경우, 정산 기록도 같은 시장의 최신 상태로 맞춥니다.
  window.addEventListener('jorong:comments-changed', () => {
    if (!settlementView.hidden) renderSettlementCommentHistory();
  });

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

  // 하단 리포트 탭으로 이동했을 때는 정산 전용 헤더를 제거하고, 다시 거래소로 돌아오면 복원합니다.
  window.addEventListener('jorong:view-changed', syncSettlementShellState);
  shareButton?.addEventListener('click', shareSettlementResult);

  window.MarketSettlementUI = Object.freeze({ show, renderSettlement, revealSettlementView, syncSettlementShellState });
})();
