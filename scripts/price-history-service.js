// [가격 이력 서비스] 현재 회차의 투자 기록을 캔들 데이터로 읽어오며, Supabase 미연결 때는 로컬 투자 결과로 즉시 갱신합니다.
window.PriceHistoryService = (() => {
  const supabaseClient = window.JorongSupabase;
  const marketConfig = window.MarketConfig.get();
  const { session, subject } = marketConfig;
  const localEvents = [];
  // [적응형 캔들 단위] 시장 전체 시간을 약 720개 구간으로 나눠, 짧은 장에서는 더 촘촘하게
  // 주문 흐름을 보여주고 긴 장에서는 불필요하게 많은 캔들이 쌓이지 않도록 합니다.
  const CANDLE_INTERVAL_STEPS = [5, 10, 15, 30, 60];
  const TARGET_CANDLE_SLOTS = 720;
  // 서버가 반환한 시장 최초 가격을 보관합니다. 차트는 이 값을 Y축 기준선으로 사용해야
  // 운영 설정 캐시가 오래되었을 때도 실제 장의 기준가와 맞춰서 그려집니다.
  let latestInitialPrice = Number(subject.initialPrice);
  let latestCandleIntervalSeconds = 60;
  // [서버 이력 단조성] 주문 취소가 없는 MVP에서 같은 시장의 확정 캔들 이력은
  // 시간·누적 거래량 기준으로 뒤로 갈 수 없습니다. 복제 지연이나 캐시로 더 오래된 응답이 오면
  // 직전에 확인한 이력을 유지해 차트가 잠깐 깨지는 현상을 막습니다.
  let latestServerHistory = null;

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

  // [캔들 단위 선택] 운영 설정에서 명시하면 그 값을 우선하고, 없으면 시장 개방 시간을 기준으로
  // 5·10·15·30·60초 중 하나를 선택합니다. 예: 3시간 장은 15초, 6시간 장은 30초 단위입니다.
  function getPreferredCandleIntervalSeconds() {
    const configured = Number(session.candleIntervalSeconds);
    if (CANDLE_INTERVAL_STEPS.includes(configured)) return configured;

    const durationSeconds = Math.max(1, Math.round(Number(session.durationHours) * 60 * 60));
    const desiredInterval = Math.ceil(durationSeconds / TARGET_CANDLE_SLOTS);
    return CANDLE_INTERVAL_STEPS.find((interval) => interval >= desiredInterval)
      || CANDLE_INTERVAL_STEPS.at(-1);
  }

  // [캔들 보정] 백엔드 응답의 가격·시각 필드를 안전한 숫자로 통일합니다.
  function normalizeCandle(candle) {
    const { startAt, endAt } = getSessionRange();
    // Supabase RPC는 camelCase를 기본 계약으로 사용합니다. 다만 SQL 행을 그대로 반환하는
    // 구현도 안전하게 처리할 수 있도록 snake_case 시각 필드도 허용합니다.
    const startedAt = Date.parse(candle.startedAt || candle.started_at || candle.openedAt || candle.timestamp) || startAt;
    const endedAt = Date.parse(candle.endedAt || candle.ended_at) || Math.min(endAt, startedAt + 60_000);
    const open = Number(candle.open);
    const high = Number(candle.high);
    const low = Number(candle.low);
    const close = Number(candle.close);

    // 2026-08-19: 서버 가격이 마이너스여도 거래가 계속되도록 바뀌어서, 여기서도 양수 여부는
    // 더 이상 걸러내지 않습니다(걸러내면 가격이 마이너스로 내려간 뒤의 캔들이 전부 사라져
    // 그래프가 멈춘 것처럼 보이는 버그가 있었습니다). 숫자가 아닌 값(NaN 등)만 걸러냅니다.
    if (![open, high, low, close].every((value) => Number.isFinite(value))) return null;
    return { startedAt, endedAt, open, high: Math.max(open, high, low, close), low: Math.min(open, high, low, close), close, volume: Number(candle.volume) || 0 };
  }

  function getHistoryRevision(body) {
    const value = body?.revision
      ?? body?.marketRevision
      ?? body?.market_revision
      ?? body?.market?.revision
      ?? body?.market?.marketRevision;
    const revision = Number(value);
    return Number.isFinite(revision) ? revision : null;
  }

  function summarizeCandles(candles) {
    return candles.reduce((summary, candle) => ({
      count: summary.count + 1,
      latestEndedAt: Math.max(summary.latestEndedAt, Number(candle.endedAt) || 0),
      totalVolume: summary.totalVolume + Math.max(0, Number(candle.volume) || 0),
    }), { count: 0, latestEndedAt: 0, totalVolume: 0 });
  }

  function cloneCandles(candles) {
    return candles.map((candle) => ({ ...candle }));
  }

  function acceptServerHistory({ marketId, candles, revision, asOf }) {
    const summary = summarizeCandles(candles);
    const previous = latestServerHistory;
    const isSameMarket = previous?.marketId === marketId;
    const hasOlderRevision = isSameMarket
      && previous.revision != null
      && revision != null
      && revision < previous.revision;
    // `revision`을 아직 제공하지 않는 백엔드와도 호환되도록, 주문 원장이 감소할 수 없는
    // 현재 규칙으로 응답의 최소 단조성을 검증합니다.
    const hasOlderAggregate = isSameMarket
      && (summary.count < previous.summary.count
        || summary.latestEndedAt < previous.summary.latestEndedAt
        || summary.totalVolume + 1e-9 < previous.summary.totalVolume);

    if (hasOlderRevision || hasOlderAggregate) return cloneCandles(previous.candles);

    latestServerHistory = {
      marketId,
      revision,
      asOf: asOf || null,
      candles: cloneCandles(candles),
      summary,
    };
    return candles;
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
    if (!supabaseClient) {
      latestCandleIntervalSeconds = getPreferredCandleIntervalSeconds();
      return buildLocalCandles();
    }

    const preferredInterval = getPreferredCandleIntervalSeconds();

    async function requestCandles(intervalSeconds) {
      const { data, error } = await supabaseClient.rpc('get_market_candles', {
        p_market_id: getMarketSessionId(),
        p_interval_seconds: intervalSeconds,
      });
      if (error) throw new Error(error.message || '가격 이력을 불러오지 못했습니다.');

      const body = data || {};
      // 응답 필드가 없는데 빈 배열처럼 처리하면, 이미 표시 중인 그래프가 기준가 한 개짜리
      // 화면으로 되돌아갑니다. 서버 계약 오류는 차트 UI가 기존 그래프를 유지할 수 있게 명시적으로 알립니다.
      if (!Array.isArray(body.candles)) {
        throw new Error('가격 이력 응답 형식이 올바르지 않습니다.');
      }
      // 캔들 RPC도 base_price 원본 컬럼 또는 initialPrice 별칭 중 어느 쪽이든 최초가격으로 읽습니다.
      const responseInitialPrice = Number(body.initialPrice ?? body.initial_price ?? body.basePrice ?? body.base_price);
      if (Number.isFinite(responseInitialPrice) && responseInitialPrice > 0) {
        latestInitialPrice = responseInitialPrice;
      }
      latestCandleIntervalSeconds = intervalSeconds;
      const normalizedCandles = body.candles
        .map(normalizeCandle)
        .filter(Boolean)
        // 서버 응답 순서와 상관없이 시간축에 맞춰 캔들을 그립니다.
        .sort((left, right) => left.startedAt - right.startedAt);
      return acceptServerHistory({
        marketId: String(body.marketSessionId ?? body.market_session_id ?? body.marketId ?? getMarketSessionId()),
        candles: normalizedCandles,
        revision: getHistoryRevision(body),
        asOf: body.asOf ?? body.as_of ?? body.updatedAt ?? body.updated_at,
      });
    }

    try {
      return await requestCandles(preferredInterval);
    } catch (error) {
      // 기존 백엔드가 60초 단위만 지원하는 상태에서도 그래프 자체가 멈추지 않도록 호환 요청을 합니다.
      // 짧은 단위가 지원되기 시작하면 첫 요청이 성공하므로 이 경로는 실행되지 않습니다.
      if (preferredInterval === 60) throw error;
      return requestCandles(60);
    }
  }

  // [투자 반영] Supabase 미연결에서는 즉시 로컬 캔들을 추가하고, 연결 시에는 서버 집계값을 다시 조회합니다.
  async function recordInvestment(result) {
    // [서버 우선] 배포 환경에서는 프론트가 만든 "내 주문만의 임시 캔들"을 그리지 않습니다.
    // 주문 트랜잭션으로 확정된 모든 참여자의 서버 집계 캔들만 사용해야, 잠깐 보였다가
    // 다음 폴링에서 모양이 바뀌는 현상을 막을 수 있습니다.
    if (supabaseClient) return loadCandles();

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

  return Object.freeze({
    getSessionRange,
    // [차트 기준가] API 응답이 있으면 서버값을, 로컬 시연이면 market-config의 최초 가격을 반환합니다.
    getInitialPrice: () => latestInitialPrice,
    // [차트 시간 단위] 실제 서버가 응답한 단위를 UI가 읽어 캔들 폭을 실제 시간 비율에 맞춥니다.
    getCandleIntervalSeconds: () => latestCandleIntervalSeconds,
    // 디버깅·운영 확인용: 마지막으로 수용한 서버 이력의 버전과 조회 기준 시각입니다.
    getLatestServerHistoryMeta: () => latestServerHistory && ({
      marketId: latestServerHistory.marketId,
      revision: latestServerHistory.revision,
      asOf: latestServerHistory.asOf,
      ...latestServerHistory.summary,
    }),
    loadCandles,
    recordInvestment,
  });
})();
