// [투자 서비스] 투자·지갑·투자 내역을 API와 연결합니다. API 주소가 없을 때만 시연용 로컬 상태를 사용합니다.
(() => {
  const API_BASE_URL = (window.JORONG_API_BASE_URL || '').replace(/\/$/, '');
  const marketConfig = window.MarketConfig.get();
  const TARGET_ID = marketConfig.subject.id;
  const PRICE_IMPACT_RATE = 0.01;
  const state = {
    walletPoints: 10000,
    targetValue: marketConfig.subject.initialPrice,
    investments: [],
  };

  // [현재 세션 ID] 서버 시계가 다른 라운드를 반환한 경우에도 투자·차트·댓글이 같은 시장을 참조하도록 동적으로 읽습니다.
  function getMarketSessionId() {
    return window.MarketCountdown?.getSessionId?.() || marketConfig.session.id;
  }

  function getAuthHeaders() {
    return window.AuthService?.getRequestHeaders?.() || {};
  }

  function assertMarketIsOpen() {
    if (window.MarketCountdown?.requiresServerClock?.() && !window.MarketCountdown.isReady()) {
      throw new Error('거래 시간을 확인 중입니다. 잠시 후 다시 시도해주세요.');
    }
    if (window.MarketCountdown?.isEnded()) throw new Error('거래가 종료되었습니다.');
  }

  // [응답 상태 반영] API가 돌려준 최신 지갑·종목 가격을 후속 투자와 UI가 공유하도록 저장합니다.
  function applySnapshot(result = {}) {
    const points = Number(result.wallet?.points ?? result.account?.points);
    const targetValue = Number(result.target?.value);
    if (Number.isFinite(points)) state.walletPoints = points;
    if (Number.isFinite(targetValue)) state.targetValue = targetValue;
    if (result.investment) state.investments.unshift(result.investment);
    return result;
  }

  // [로컬 투자] 백엔드 연결 전 화면 시연용입니다. 실제 가격·잔액 계산은 서버 트랜잭션으로만 확정해야 합니다.
  function createLocalInvestment({ targetId, side, amount, marketSessionId }) {
    assertMarketIsOpen();
    if (marketSessionId && marketSessionId !== getMarketSessionId()) throw new Error('현재 거래 세션과 일치하지 않습니다.');
    if (targetId !== TARGET_ID) throw new Error('존재하지 않는 투자 항목입니다.');
    if (!['SUPPORT', 'ROAST'].includes(side)) throw new Error('투자 방향이 올바르지 않습니다.');
    if (!Number.isInteger(amount) || amount < 10) throw new Error('투자 금액이 올바르지 않습니다.');
    if (amount > state.walletPoints) throw new Error('보유 포인트가 부족합니다.');

    const previousValue = state.targetValue;
    const valueChange = Math.max(1, Math.round(amount * PRICE_IMPACT_RATE)) * (side === 'SUPPORT' ? 1 : -1);
    state.walletPoints -= amount;
    state.targetValue = Math.max(1, state.targetValue + valueChange);
    const investment = {
      id: `local-investment-${Date.now()}`,
      marketSessionId: getMarketSessionId(),
      targetId,
      side,
      amount,
      createdAt: new Date().toISOString(),
    };
    state.investments.unshift(investment);
    return {
      investment,
      wallet: { points: state.walletPoints },
      target: { id: targetId, previousValue, value: state.targetValue, valueChange: state.targetValue - previousValue },
    };
  }

  // [투자 생성] 서버는 로그인 사용자·세션 상태·잔액을 검증하고 투자/잔액/가격 캔들을 하나의 DB 트랜잭션으로 처리해야 합니다.
  async function createInvestment(payload) {
    assertMarketIsOpen();
    if (!API_BASE_URL) return createLocalInvestment(payload);
    const response = await fetch(`${API_BASE_URL}/investments`, {
      method: 'POST',
      credentials: 'include',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...getAuthHeaders() },
      body: JSON.stringify({ ...payload, marketSessionId: getMarketSessionId() }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.message || '투자 요청에 실패했습니다.');
    return applySnapshot(body);
  }

  // [내 투자 내역] 마이페이지/재로그인 시 서버가 보관한 투자 로그와 최신 포인트를 가져오기 위한 조회 API입니다.
  async function loadMyInvestments() {
    if (!API_BASE_URL) return { wallet: { points: state.walletPoints }, investments: state.investments };
    const params = new URLSearchParams({ marketSessionId: getMarketSessionId() });
    const response = await fetch(`${API_BASE_URL}/me/investments?${params}`, {
      method: 'GET',
      credentials: 'include',
      headers: { Accept: 'application/json', ...getAuthHeaders() },
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.message || '투자 내역을 불러오지 못했습니다.');
    applySnapshot(body);
    return body;
  }

  // [세션 갱신] 로그인·재로그인 결과가 도착하면 투자 창의 보유 포인트를 즉시 업데이트합니다.
  window.addEventListener('jorong:auth-session', (event) => {
    const points = Number(event.detail?.wallet?.points ?? event.detail?.account?.points);
    if (Number.isFinite(points)) state.walletPoints = points;
  });

  function getSnapshot() {
    return { wallet: { points: state.walletPoints }, target: { id: TARGET_ID, value: state.targetValue }, investments: state.investments };
  }

  window.InvestmentService = Object.freeze({
    TARGET_ID,
    MARKET_SESSION_ID: marketConfig.session.id,
    getMarketSessionId,
    createInvestment,
    loadMyInvestments,
    getSnapshot,
  });
})();
