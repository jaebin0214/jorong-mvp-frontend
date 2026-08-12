// [가격 이력 서비스] 현재 회차의 투자 기록을 캔들 데이터로 읽어오며, API 미연결 때는 로컬 투자 결과로 즉시 갱신합니다.
window.PriceHistoryService = (() => {
  const API_BASE_URL = (window.JORONG_API_BASE_URL || '').replace(/\/$/, '');
  const marketConfig = window.MarketConfig.get();
  const { session, subject } = marketConfig;
  const localEvents = [];

  // [현재 시장 ID] 서버 시계가 다른 라운드를 지정해도 해당 라운드의 모든 투자 기록으로 캔들을 조회합니다.
  function getMarketSessionId() {
    return window.MarketCountdown?.getSessionId?.() || session.id;
  }

  function getAuthHeaders() {
    return window.AuthService?.getRequestHeaders?.() || {};
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

    localEvents.forEach((event) => {
      const previousClose = priorEvents.at(-1).close;
      const price = event.price;
      priorEvents.push({
        startedAt: Math.max(startAt, Math.min(endAt, event.timestamp)),
        endedAt: Math.max(startAt, Math.min(endAt, event.timestamp + 60_000)),
        open: previousClose,
        high: Math.max(previousClose, price),
        low: Math.min(previousClose, price),
        close: price,
        volume: event.amount,
      });
    });

    return priorEvents;
  }

  // [캔들 조회] API가 있으면 DB의 투자 기록으로 집계된 캔들을 받고, 없으면 로컬 이력을 사용합니다.
  async function loadCandles() {
    if (!API_BASE_URL) return buildLocalCandles();

    const params = new URLSearchParams({ targetId: subject.id, intervalSeconds: '60' });
    const response = await fetch(`${API_BASE_URL}/markets/${encodeURIComponent(getMarketSessionId())}/candles?${params}`, {
      credentials: 'include',
      headers: { Accept: 'application/json', ...getAuthHeaders() },
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.message || '가격 이력을 불러오지 못했습니다.');
    }

    const body = await response.json();
    return (body.candles || [])
      .map(normalizeCandle)
      .filter(Boolean)
      // 서버 응답 순서와 상관없이 시간축에 맞춰 캔들을 그립니다.
      .sort((left, right) => left.startedAt - right.startedAt);
  }

  // [투자 반영] API 미연결에서는 즉시 로컬 캔들을 추가하고, API 연결 시에는 서버 집계값을 다시 조회합니다.
  async function recordInvestment(result) {
    if (API_BASE_URL) return loadCandles();

    const price = Number(result.target?.value);
    if (Number.isFinite(price) && price > 0) {
      localEvents.push({
        timestamp: Date.parse(result.investment?.createdAt) || Date.now(),
        price,
        amount: Number(result.investment?.amount) || 0,
      });
    }
    return buildLocalCandles();
  }

  return Object.freeze({ getSessionRange, loadCandles, recordInvestment });
})();
