// [가격 이력 서비스] 현재 회차의 투자 기록을 캔들 데이터로 읽어오며, Supabase 미연결 때는 로컬 투자 결과로 즉시 갱신합니다.
window.PriceHistoryService = (() => {
  const supabaseClient = window.JorongSupabase;
  const marketConfig = window.MarketConfig.get();
  const { session, subject } = marketConfig;
  const localEvents = [];

  // [현재 시장 ID] 서버 시계가 다른 라운드를 지정해도 해당 라운드의 모든 투자 기록으로 캔들을 조회합니다.
  function getMarketSessionId() {
    return window.MarketCountdown?.getSessionId?.() || session.id;
  }

  // [회차 범위] X축은 시작부터 종료까지 고정해, 캔들이 적어도 설정된 거래 시간 전체를 기준으로 보입니다.
  function getSessionRange() {
    // 백엔드 시계가 최초 동기화되기 전에는 임시 범위를 사용하고, 동기화 이벤트 후 차트를 다시 그립니다.
    const endAt = window.MarketCountdown.getEndAt() || (Date.now() + (session.durationHours * 60 * 60 * 1000));
    const startAt = session.startsAt ? Date.parse(session.startsAt) : endAt - (session.durationHours * 60 * 60 * 1000);
    return { startAt, endAt };
  }

  // [캔들 보정] 백엔드 응답의 가격·시각 필드를 안전한 숫자로 통일합니다.
  function normalizeCandle(candle) {
    const { startAt, endAt } = getSessionRange();
    const startedAt = Date.parse(candle.startedAt || candle.openedAt || candle.timestamp) || startAt;
    const endedAt = Date.parse(candle.endedAt) || Math.min(endAt, startedAt + 60_000);
    const open = Number(candle.open);
    const high = Number(candle.high);
    const low = Number(candle.low);
    const close = Number(candle.close);

    if (![open, high, low, close].every((value) => Number.isFinite(value) && value > 0)) return null;
    return { startedAt, endedAt, open, high: Math.max(open, high, low, close), low: Math.min(open, high, low, close), close, volume: Number(candle.volume) || 0 };
  }

  // [로컬 캔들] 투자 시점과 가격 변동값을 하나의 캔들로 만들어 MVP에서도 그래프 변화를 확인합니다.
  function buildLocalCandles() {
    const { startAt, endAt } = getSessionRange();
    const baseCandle = { startedAt: startAt, endedAt: Math.min(endAt, startAt + 60_000), open: subject.initialPrice, high: subject.initialPrice, low: subject.initialPrice, close: subject.initialPrice, volume: 0 };
    const priorEvents = [baseCandle];

    // 새로고침 뒤에는 같은 회차 원장에 저장된 모든 사용자 주문으로 캔들을 다시 만듭니다.
    // Supabase 연결 시에는 아래 loadCandles()가 DB 집계 캔들을 반환하므로 이 로직을 사용하지 않습니다.
    const persistedOrders = window.InvestmentService?.getMarketOrders?.()
      || window.InvestmentService?.getSnapshot?.().orders
      || [];
    const persistedEvents = persistedOrders
      .map((order) => ({
        id: order.id,
        timestamp: Date.parse(order.createdAt) || startAt,
        price: Number(order.resultingPrice || order.executionPrice),
        amount: Number(order.investmentAmount ?? order.amount) || 0,
        side: order.side,
      }))
      .filter((event) => Number.isFinite(event.price) && event.price > 0);
    const events = [...persistedEvents, ...localEvents]
      .filter((event, index, all) => event.id ? all.findIndex((candidate) => candidate.id === event.id) === index : true)
      .sort((left, right) => left.timestamp - right.timestamp);

    events.forEach((event) => {
      const previousClose = priorEvents.at(-1).close;
      const direction = String(event.side || '').toUpperCase() === 'SUPPORT' ? 1 : -1;
      const priceDistance = Math.max(1, Math.abs(event.price - previousClose));
      // 첫 투자와 추가 투자 모두 선택한 의견의 방향으로 종가를 확정합니다.
      const close = direction > 0
        ? Math.max(event.price, previousClose + priceDistance)
        : Math.max(1, Math.min(event.price, previousClose - priceDistance));
      const wickSize = Math.max(1, priceDistance * 0.28);
      priorEvents.push({
        startedAt: Math.max(startAt, Math.min(endAt, event.timestamp)),
        endedAt: Math.max(startAt, Math.min(endAt, event.timestamp + 60_000)),
        open: previousClose,
        high: Math.max(previousClose, close) + wickSize,
        low: Math.max(0.01, Math.min(previousClose, close) - wickSize),
        close,
        volume: event.amount,
      });
    });

    return priorEvents;
  }

  // [캔들 조회] Supabase 연결 시 DB의 모든 사용자 투자 기록으로 집계된 캔들(get_market_candles RPC)을 받고,
  // 없으면 같은 브라우저의 공유 로컬 원장을 사용합니다. 로그인 여부와 무관하게 누구나 조회할 수 있습니다.
  async function loadCandles() {
    if (!supabaseClient) return buildLocalCandles();

    const { data, error } = await supabaseClient.rpc('get_market_candles', {
      p_market_id: getMarketSessionId(),
      p_interval_seconds: 60,
    });
    if (error) throw new Error(error.message || '가격 이력을 불러오지 못했습니다.');

    const body = data || {};
    return (body.candles || [])
      .map(normalizeCandle)
      .filter(Boolean)
      // 서버 응답 순서와 상관없이 시간축에 맞춰 캔들을 그립니다.
      .sort((left, right) => left.startedAt - right.startedAt);
  }

  // [투자 반영] Supabase 미연결에서는 즉시 로컬 캔들을 추가하고, 연결 시에는 서버 집계값을 다시 조회합니다.
  async function recordInvestment(result) {
    // [즉시 반영] 첫 투자와 추가 투자 모두 주문 응답의 최신 가격으로 임시 캔들을 만들고, 서버 응답 전에도 화면에 표시합니다.
    const price = Number(
      result.target?.value
      ?? result.target?.currentPrice
      ?? result.order?.resultingPrice
      ?? result.investment?.resultingPrice
      ?? result.order?.executionPrice,
    );
    const id = result.order?.id || result.investment?.id || `optimistic-order-${Date.now()}`;
    if (Number.isFinite(price) && price > 0) {
      const event = {
        id,
        timestamp: Date.parse(result.order?.createdAt || result.investment?.createdAt) || Date.now(),
        price,
        amount: Number(result.order?.investmentAmount ?? result.investment?.investmentAmount ?? result.investment?.amount ?? result.order?.amount) || 0,
        side: result.order?.side || result.investment?.side || result.position?.side,
      };
      const existingIndex = localEvents.findIndex((candidate) => candidate.id === id);
      if (existingIndex >= 0) localEvents[existingIndex] = event;
      else localEvents.push(event);
    }
    return buildLocalCandles();
  }

  return Object.freeze({ getSessionRange, loadCandles, recordInvestment });
})();
