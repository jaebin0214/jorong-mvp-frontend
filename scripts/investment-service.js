// [투자·포지션 서비스] 주문, 가중평균 포지션, 잔액, 장 종료 정산을 API 우선으로 다룹니다.
// API 주소가 비어 있는 현재 정적 MVP에서는 동일한 계약의 로컬 영속 시뮬레이터를 사용합니다.
(() => {
  const API_BASE_URL = (window.JORONG_API_BASE_URL || '').replace(/\/$/, '');
  const config = window.MarketConfig.get();
  const TARGET_ID = config.subject.id;
  const PRICE_IMPACT_RATE = 0.01; // 기존 MVP의 가격 반영 규칙을 유지합니다. 실제 운영의 가격 산식은 서버에서 확정합니다.
  const LOCAL_STORE_VERSION = 2;
  const LOCAL_STORE_KEY = `jorong:investment-ledger:${config.session.id}`;
  const INITIAL_POINTS = 10000;
  // [저장소 예외 대비] file://, 시크릿 모드 등 localStorage를 쓸 수 없는 환경에서도
  // 같은 접속 중에는 첫 주문 뒤의 잔액 원장을 잃지 않도록 메모리 사본을 유지합니다.
  let memoryLocalLedger = null;
  const state = {
    walletPoints: INITIAL_POINTS,
    targetValue: config.subject.initialPrice,
    previousTargetValue: config.subject.initialPrice,
    position: null,
    orders: [],
    market: null,
    marketSummary: null,
    settlement: null,
  };

  function createError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
  }

  function getMarketSessionId() {
    return window.MarketCountdown?.getSessionId?.() || config.session.id;
  }

  function getAuthHeaders() {
    return window.AuthService?.getRequestHeaders?.() || {};
  }

  function getCurrentUserKey() {
    const account = window.AuthService?.getCurrentAccount?.();
    return String(account?.id || account?.nickname || 'local-visitor');
  }

  function getInitialWalletPoints() {
    const accountPoints = Number(window.AuthService?.getCurrentAccount?.()?.points);
    return Number.isFinite(accountPoints) && accountPoints >= 0 ? Math.round(accountPoints) : INITIAL_POINTS;
  }

  function getLocalNextOpenAt(closeAt) {
    const configured = Date.parse(config.session.nextOpenAt || '');
    if (Number.isFinite(configured)) return new Date(configured).toISOString();
    return new Date(closeAt + (24 * 60 * 60 * 1000)).toISOString();
  }

  // [로컬 원장 생성] 브라우저를 새로고침해도 같은 회차·사용자 조합의 주문과 포지션을 복원합니다.
  function createLocalLedger() {
    const closeAt = window.MarketCountdown?.getEndAt?.() || (Date.now() + (config.session.durationHours * 60 * 60 * 1000));
    return {
      version: LOCAL_STORE_VERSION,
      market: {
        id: getMarketSessionId(),
        status: 'OPEN',
        openAt: config.session.startsAt || new Date(closeAt - (config.session.durationHours * 60 * 60 * 1000)).toISOString(),
        closeAt: new Date(closeAt).toISOString(),
        nextOpenAt: getLocalNextOpenAt(closeAt),
        currentPrice: String(config.subject.initialPrice),
        previousPrice: String(config.subject.initialPrice),
        closePrice: null,
        sideTotals: { SUPPORT: '0', MOCK: '0' },
      },
      accounts: {},
    };
  }

  function loadLocalLedger() {
    const isCurrentLedger = (ledger) => ledger?.version === LOCAL_STORE_VERSION && ledger?.market?.id === getMarketSessionId();
    // localStorage 접근이 막힌 경우에도 추가 투자 때 새 10,000 KRW 원장을 만들지 않게 합니다.
    if (isCurrentLedger(memoryLocalLedger)) return memoryLocalLedger;
    try {
      const stored = JSON.parse(window.localStorage.getItem(LOCAL_STORE_KEY) || 'null');
      if (isCurrentLedger(stored)) {
        memoryLocalLedger = stored;
        return memoryLocalLedger;
      }
    } catch (_) {
      // 손상된 시연 데이터는 새로운 회차 원장으로 교체합니다.
    }
    const ledger = createLocalLedger();
    saveLocalLedger(ledger);
    return ledger;
  }

  function saveLocalLedger(ledger) {
    // 화면에서 이어지는 모든 주문은 이 원장을 공통으로 사용합니다.
    memoryLocalLedger = ledger;
    try { window.localStorage.setItem(LOCAL_STORE_KEY, JSON.stringify(ledger)); } catch (_) { /* 저장 공간 제한 시 현재 화면 상태만 유지합니다. */ }
  }

  function ensureLocalAccount(ledger) {
    const key = getCurrentUserKey();
    if (!ledger.accounts[key]) {
      ledger.accounts[key] = {
        walletPoints: getInitialWalletPoints(),
        position: null,
        orders: [],
        settlement: null,
        processedIdempotencyKeys: [],
      };
    }
    return ledger.accounts[key];
  }

  function readMarketStatus(ledger) {
    if (window.MarketCountdown?.isEnded?.() && ledger.market.status === 'OPEN') ledger.market.status = 'CLOSED';
    return ledger.market.status;
  }

  function buildLocalMarketSummary(ledger) {
    const support = BigInt(ledger.market.sideTotals?.SUPPORT || '0');
    const mock = BigInt(ledger.market.sideTotals?.MOCK || '0');
    const total = support + mock;
    const percentage = (part) => total > 0n ? Number((part * 10000n) / total) / 100 : 0;
    const participants = Object.values(ledger.accounts).filter((account) => account.position).length;
    return {
      supportInvestment: support.toString(),
      mockInvestment: mock.toString(),
      totalVolume: total.toString(),
      supportRatio: percentage(support),
      mockRatio: percentage(mock),
      participants,
    };
  }

  function toTarget(market) {
    const value = Number(market.currentPrice);
    const previousValue = Number(market.previousPrice ?? market.currentPrice);
    return {
      id: TARGET_ID,
      previousValue,
      value,
      valueChange: value - previousValue,
    };
  }

  function calculatePositionMetrics(position, currentPrice) {
    return position ? window.FinancialMath.calculateMetrics({ position, currentPrice }) : null;
  }

  function buildLocalSnapshot(ledger) {
    const account = ensureLocalAccount(ledger);
    const target = toTarget(ledger.market);
    const summary = buildLocalMarketSummary(ledger);
    const position = account.position;
    const positionMetrics = calculatePositionMetrics(position, target.value);
    return {
      market: { ...ledger.market, summary },
      wallet: { points: account.walletPoints },
      target,
      position,
      positionMetrics,
      settlement: account.settlement,
      investments: account.orders,
      orders: account.orders,
      marketSummary: summary,
    };
  }

  function applySnapshot(payload = {}) {
    const walletPoints = Number(payload.wallet?.points ?? payload.account?.points);
    const target = payload.target || {};
    const market = payload.market || payload.session || {};
    const position = payload.position ?? payload.openPosition ?? null;
    const orders = payload.orders || payload.investments || payload.investmentLogs;

    if (Number.isFinite(walletPoints)) state.walletPoints = Math.round(walletPoints);
    if (Number.isFinite(Number(target.value ?? market.currentPrice))) {
      state.targetValue = Number(target.value ?? market.currentPrice);
      state.previousTargetValue = Number(target.previousValue ?? market.previousPrice ?? state.targetValue);
    }
    if (Object.keys(market).length) state.market = market;
    if (position !== undefined) state.position = position;
    if (Array.isArray(orders)) state.orders = orders;
    if (payload.settlement !== undefined) state.settlement = payload.settlement;
    state.marketSummary = payload.marketSummary || market.summary || state.marketSummary;
    return buildStateSnapshot(payload);
  }

  function buildStateSnapshot(payload = {}) {
    const target = payload.target || {
      id: TARGET_ID,
      previousValue: state.previousTargetValue,
      value: state.targetValue,
      valueChange: state.targetValue - state.previousTargetValue,
    };
    const position = payload.position ?? state.position;
    const positionMetrics = payload.positionMetrics || payload.metrics || calculatePositionMetrics(position, target.value);
    return {
      ...payload,
      wallet: { points: Number(payload.wallet?.points ?? state.walletPoints) },
      target,
      position,
      positionMetrics,
      settlement: payload.settlement ?? state.settlement,
      investments: payload.investments || payload.orders || state.orders,
      orders: payload.orders || payload.investments || state.orders,
      market: payload.market || state.market,
      marketSummary: payload.marketSummary || state.marketSummary,
    };
  }

  function applyLocalSnapshot(snapshot) {
    return applySnapshot(snapshot);
  }

  function makeIdempotencyKey() {
    if (window.crypto?.randomUUID) return window.crypto.randomUUID();
    return `order-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function assertMarketOpen() {
    if (window.MarketCountdown?.requiresServerClock?.() && !window.MarketCountdown.isReady()) {
      throw createError('MARKET_CLOCK_UNAVAILABLE', '거래 시간을 확인 중입니다. 잠시 후 다시 시도해주세요.');
    }
    if (window.MarketCountdown?.isEnded?.()) throw createError('MARKET_CLOSED', '거래가 종료되었습니다.');
  }

  // [로컬 주문 체결] 지갑 차감·주문·포지션·가격을 하나의 원장 저장 단위로 함께 갱신합니다.
  function createLocalInvestment({ targetId, side, investmentAmount, amount, marketId, marketSessionId, idempotencyKey }) {
    assertMarketOpen();
    const normalizedSide = window.FinancialMath.normalizeSide(side);
    const requestedAmount = investmentAmount ?? amount;
    const integerAmount = Number(requestedAmount);
    if (!Number.isSafeInteger(integerAmount) || integerAmount <= 0) throw createError('INVALID_AMOUNT', '투자금은 1 KRW 이상의 정수여야 합니다.');
    if ((marketId || marketSessionId) && String(marketId || marketSessionId) !== getMarketSessionId()) {
      throw createError('MARKET_NOT_FOUND', '현재 거래 회차와 일치하지 않습니다.');
    }
    if (targetId !== TARGET_ID) throw createError('TARGET_NOT_FOUND', '존재하지 않는 투자 종목입니다.');

    const ledger = loadLocalLedger();
    const account = ensureLocalAccount(ledger);
    if (readMarketStatus(ledger) !== 'OPEN') throw createError('MARKET_CLOSED', '거래가 종료되었습니다.');
    if (account.position?.side && window.FinancialMath.normalizeSide(account.position.side) !== normalizedSide) {
      throw createError('POSITION_LOCKED', '한 번 선택한 의견은 장 종료까지 변경할 수 없습니다.');
    }
    // [잔액 기준] 매 주문은 최초 지급액이 아니라, 같은 원장에 저장된 직전 주문 후 잔액을 기준으로 검사합니다.
    const balanceBeforeOrder = Number(account.walletPoints);
    if (!Number.isSafeInteger(balanceBeforeOrder) || balanceBeforeOrder < 0) {
      throw createError('WALLET_STATE_INVALID', '보유 포인트 상태를 확인할 수 없습니다. 새로고침 후 다시 시도해주세요.');
    }
    if (integerAmount > balanceBeforeOrder) throw createError('INSUFFICIENT_BALANCE', '보유 포인트가 부족합니다.');

    const safeIdempotencyKey = String(idempotencyKey || makeIdempotencyKey());
    if (account.processedIdempotencyKeys.includes(safeIdempotencyKey)) {
      throw createError('DUPLICATE_ORDER', '이미 처리된 투자 요청입니다.');
    }

    const executionPrice = ledger.market.currentPrice;
    const nextPosition = window.FinancialMath.calculatePositionAfterOrder({
      position: account.position,
      side: normalizedSide,
      investmentAmount: integerAmount,
      executionPrice,
    });
    const previousValue = Number(ledger.market.currentPrice);
    const direction = normalizedSide === 'SUPPORT' ? 1 : -1;
    const priceImpact = Math.max(1, Math.round(integerAmount * PRICE_IMPACT_RATE)) * direction;
    const nextValue = Math.max(1, previousValue + priceImpact);
    const order = {
      id: `local-order-${Date.now()}-${account.orders.length + 1}`,
      marketId: getMarketSessionId(),
      marketSessionId: getMarketSessionId(),
      targetId: TARGET_ID,
      side: normalizedSide,
      investmentAmount: String(integerAmount),
      amount: integerAmount, // 기존 투자 내역 UI와의 호환성입니다.
      executionPrice,
      addedQuantity: nextPosition.addedQuantity,
      resultingPrice: String(nextValue),
      idempotencyKey: safeIdempotencyKey,
      createdAt: new Date().toISOString(),
    };

    // 추가 투자는 "초기 10,000 - 이번 투자금"이 아니라 "직전 잔액 - 이번 투자금"으로 계산합니다.
    account.walletPoints = balanceBeforeOrder - integerAmount;
    account.position = { ...nextPosition, id: account.position?.id || `local-position-${getCurrentUserKey()}-${getMarketSessionId()}`, updatedAt: order.createdAt };
    account.orders.unshift(order);
    account.processedIdempotencyKeys.push(safeIdempotencyKey);
    ledger.market.sideTotals[normalizedSide] = (BigInt(ledger.market.sideTotals[normalizedSide] || '0') + BigInt(integerAmount)).toString();
    ledger.market.previousPrice = String(previousValue);
    ledger.market.currentPrice = String(nextValue);
    saveLocalLedger(ledger);

    return applyLocalSnapshot({
      ...buildLocalSnapshot(ledger),
      order,
      investment: order,
    });
  }

  // [로컬 정산] 같은 원장에 settlement가 이미 있으면 다시 지급하지 않아 브라우저 시연에서도 멱등성을 보장합니다.
  function settleLocalMarket() {
    const ledger = loadLocalLedger();
    const account = ensureLocalAccount(ledger);
    if (ledger.market.status === 'OPEN') ledger.market.status = 'CLOSED';
    if (!ledger.market.closePrice) ledger.market.closePrice = ledger.market.currentPrice;

    if (!account.settlement && account.position?.status !== 'SETTLED') {
      const settlement = window.FinancialMath.calculateSettlement({
        position: account.position,
        closePrice: ledger.market.closePrice,
        balanceBeforeSettlement: account.walletPoints,
      });
      if (settlement) {
        account.walletPoints = Number(settlement.balanceAfterSettlement);
        account.position = { ...account.position, status: 'SETTLED', updatedAt: new Date().toISOString() };
        account.settlement = {
          id: `local-settlement-${getCurrentUserKey()}-${getMarketSessionId()}`,
          marketId: getMarketSessionId(),
          positionId: account.position.id,
          ...settlement,
          settledAt: new Date().toISOString(),
        };
      }
    }
    ledger.market.status = 'SETTLED';
    saveLocalLedger(ledger);
    const snapshot = applyLocalSnapshot(buildLocalSnapshot(ledger));
    window.dispatchEvent(new CustomEvent('jorong:market-settled', { detail: snapshot }));
    return snapshot;
  }

  function backendError(payload, fallback) {
    const error = createError(payload?.code || 'REQUEST_FAILED', payload?.message || fallback);
    error.details = payload?.details;
    return error;
  }

  async function request(path, options = {}) {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      credentials: 'include',
      headers: { Accept: 'application/json', ...getAuthHeaders(), ...(options.headers || {}) },
      ...options,
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw backendError(body, '요청을 처리하지 못했습니다.');
    return body;
  }

  // [주문 API] 서버는 잔액 차감·주문 생성·포지션 가중평균 갱신을 하나의 DB 트랜잭션으로 처리해야 합니다.
  async function createInvestment(payload) {
    assertMarketOpen();
    const requestPayload = {
      marketId: getMarketSessionId(),
      targetId: TARGET_ID,
      side: window.FinancialMath.normalizeSide(payload.side),
      investmentAmount: Number(payload.investmentAmount ?? payload.amount),
      idempotencyKey: payload.idempotencyKey || makeIdempotencyKey(),
    };
    if (!API_BASE_URL) return createLocalInvestment(requestPayload);

    const body = await request(`/markets/${encodeURIComponent(requestPayload.marketId)}/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': requestPayload.idempotencyKey },
      body: JSON.stringify(requestPayload),
    });
    return applySnapshot(body);
  }

  // [포지션 조회] 새로고침·재로그인 후에도 서버가 보관한 현재 포지션과 잔액을 그대로 복원합니다.
  async function loadPortfolio() {
    if (!API_BASE_URL) {
      const ledger = loadLocalLedger();
      if (readMarketStatus(ledger) !== 'OPEN') return settleLocalMarket();
      return applyLocalSnapshot(buildLocalSnapshot(ledger));
    }
    const body = await request(`/markets/${encodeURIComponent(getMarketSessionId())}/me/position`);
    return applySnapshot(body);
  }

  // [정산 조회] 서버 정산 작업이 완료한 결과만 읽습니다. 클라이언트는 API 연결 시 지갑에 직접 지급하지 않습니다.
  async function loadSettlement() {
    if (!API_BASE_URL) return settleLocalMarket();
    const body = await request(`/markets/${encodeURIComponent(getMarketSessionId())}/me/settlement`);
    return applySnapshot(body);
  }

  // [이전 화면 호환] 기존 마이페이지가 투자 로그를 요청할 때도 현재 포지션 응답을 사용합니다.
  async function loadMyInvestments() {
    return loadPortfolio();
  }

  function getSnapshot() {
    return buildStateSnapshot();
  }

  window.addEventListener('jorong:auth-session', (event) => {
    const points = Number(event.detail?.wallet?.points ?? event.detail?.account?.points);
    if (Number.isFinite(points)) state.walletPoints = Math.round(points);
  });

  // 장 종료 이벤트는 로컬 시연 원장을 정산하고, API 연결 환경에서는 MarketSettlementUI가 서버 정산 결과를 조회하도록 둡니다.
  window.addEventListener('jorong:market-ended', () => {
    if (!API_BASE_URL) settleLocalMarket();
  });

  window.InvestmentService = Object.freeze({
    TARGET_ID,
    getMarketSessionId,
    createInvestment,
    loadPortfolio,
    loadMyInvestments,
    loadSettlement,
    getSnapshot,
    getMarketSummary: () => state.marketSummary,
  });
})();
