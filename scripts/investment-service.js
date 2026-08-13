// [투자 서비스] Supabase가 설정되면 grant_trade_permission → place_investment RPC 순서로 호출합니다.
// 설정 전에는 기존과 동일하게 로컬 상태로 시연합니다. 반환 형태는 기존과 동일하게 유지했습니다.
(() => {
  const marketConfig = window.MarketConfig.get();
  const TARGET_ID = marketConfig.subject.id;
  const PRICE_IMPACT_RATE = 0.01;
  const state = {
    walletPoints: 10000,
    targetValue: marketConfig.subject.initialPrice,
    investments: [],
  };

  function getMarketSessionId() {
    return window.MarketCountdown?.getSessionId?.() || marketConfig.session.id;
  }

  function assertMarketIsOpen() {
    if (window.MarketCountdown?.requiresServerClock?.() && !window.MarketCountdown.isReady()) {
      throw new Error('거래 시간을 확인 중입니다. 잠시 후 다시 시도해주세요.');
    }
    if (window.MarketCountdown?.isEnded()) throw new Error('거래가 종료되었습니다.');
  }

  function applySnapshot(result = {}) {
    const points = Number(result.wallet?.points ?? result.account?.points);
    const targetValue = Number(result.target?.value);
    if (Number.isFinite(points)) state.walletPoints = points;
    if (Number.isFinite(targetValue)) state.targetValue = targetValue;
    if (result.investment) state.investments.unshift(result.investment);
    return result;
  }

  // [로컬 투자] 백엔드 연결 전 화면 시연용입니다.
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

  // [원격 투자] side는 화면에서 'SUPPORT'/'ROAST'로 쓰지만 백엔드 ENUM은 'support'/'mock'이라 변환합니다.
  // grant_trade_permission은 UNIQUE(user_id, stock_id)라 이미 권한이 있어도 에러 없이 통과한다고 가정했습니다.
  // ⚠️ 이미 권한이 있는 상태에서 재호출 시 실제로 에러가 나는지 실제 함수로 한 번 검증해주세요. 에러가 난다면
  //     "이미 권한 있음" 에러 메시지를 구분해서 무시하도록 이 부분만 수정하면 됩니다.
  async function createRemoteInvestment({ targetId, side, amount }) {
    const stock = await window.getActiveStock();
    const rpcSide = side === 'SUPPORT' ? 'support' : 'mock';

    const permission = await window.SupabaseClient.rpc('grant_trade_permission', {
      stock_id: stock.id,
      side: rpcSide,
    });
    if (permission.error) throw new Error(permission.error.message);

    const { data, error } = await window.SupabaseClient.rpc('place_investment', {
      stock_id: stock.id,
      amount,
    });
    if (error) throw new Error(error.message);

    return {
      investment: {
        id: data.investment_id,
        marketSessionId: getMarketSessionId(),
        targetId,
        side,
        amount,
        createdAt: new Date().toISOString(),
      },
      wallet: { points: data.balance },
      target: {
        id: targetId,
        previousValue: data.price_at_invest,
        value: data.new_price,
        valueChange: Number(data.new_price) - Number(data.price_at_invest),
      },
    };
  }

  async function createInvestment(payload) {
    assertMarketIsOpen();
    if (!window.SupabaseClient) return applySnapshot(createLocalInvestment(payload));
    const result = await createRemoteInvestment(payload);
    return applySnapshot(result);
  }

  // [내 투자 내역] investments 테이블에서 RLS로 본인 것만 조회됩니다.
  async function loadMyInvestments() {
    if (!window.SupabaseClient) return { wallet: { points: state.walletPoints }, investments: state.investments };

    const stock = await window.getActiveStock();
    const { data, error } = await window.SupabaseClient
      .from('investments')
      .select('*')
      .eq('stock_id', stock.id)
      .order('created_at', { ascending: false });
    if (error) throw new Error(error.message);

    const investments = (data || []).map((row) => ({
      id: row.id,
      marketSessionId: getMarketSessionId(),
      targetId: TARGET_ID,
      side: row.side === 'support' ? 'SUPPORT' : 'ROAST',
      amount: row.amount,
      createdAt: row.created_at,
    }));
    state.investments = investments;
    return { wallet: { points: state.walletPoints }, investments };
  }

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
