// [캔들 차트 UI] 회차 시간은 X축, 초기 가격 대비 변동률은 Y축으로 사용해 SVG 캔들 차트를 그립니다.
window.PriceChartUI = (() => {
  const chartContainer = document.querySelector('.exchange-chart');
  const chartStatus = document.querySelector('#exchange-chart-status');
  const config = window.MarketConfig.get();
  const hasBackendApi = Boolean((window.JORONG_API_BASE_URL || '').trim());
  const initialPrice = config.subject.initialPrice;
  const width = 620;
  const height = 160;
  const padding = { top: 8, right: 10, bottom: 25, left: 48 };
  let currentCandles = [];

  function formatPercentage(value) {
    const sign = value > 0 ? '+' : '';
    return `${sign}${value.toFixed(1)}%`;
  }

  function formatElapsedTime(timestamp, startAt) {
    const totalMinutes = Math.max(0, Math.round((timestamp - startAt) / 60_000));
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return `${hours}:${String(minutes).padStart(2, '0')}`;
  }

  // [차트 렌더링] 각 캔들의 OHLC 가격을 초기 가격 대비 비율로 변환한 뒤 좌표에 배치합니다.
  function render(candles) {
    if (!chartContainer) return;
    const { startAt, endAt } = window.PriceHistoryService.getSessionRange();
    const plotWidth = width - padding.left - padding.right;
    const plotHeight = height - padding.top - padding.bottom;
    const safeCandles = candles.length ? candles : [{ startedAt: startAt, endedAt: startAt, open: initialPrice, high: initialPrice, low: initialPrice, close: initialPrice, volume: 0 }];
    const percentageValues = safeCandles.flatMap((candle) => [candle.open, candle.high, candle.low, candle.close].map((price) => ((price - initialPrice) / initialPrice) * 100));
    const extreme = Math.max(1, ...percentageValues.map((value) => Math.abs(value))) * 1.18;
    const maxPercent = Math.ceil(extreme * 10) / 10;
    const minPercent = -maxPercent;
    const sessionDuration = Math.max(1, endAt - startAt);
    const xForTime = (timestamp) => padding.left + (Math.max(startAt, Math.min(endAt, timestamp)) - startAt) / sessionDuration * plotWidth;
    const yForPercent = (percent) => padding.top + ((maxPercent - percent) / (maxPercent - minPercent)) * plotHeight;
    const percentForPrice = (price) => ((price - initialPrice) / initialPrice) * 100;
    const grid = Array.from({ length: 5 }, (_, index) => {
      const ratio = index / 4;
      const percent = maxPercent - ((maxPercent - minPercent) * ratio);
      const y = padding.top + plotHeight * ratio;
      return `<line x1="${padding.left}" y1="${y}" x2="${width - padding.right}" y2="${y}" class="price-chart-grid" /><text x="${padding.left - 7}" y="${y + 3}" class="price-chart-y-label" text-anchor="end">${formatPercentage(percent)}</text>`;
    }).join('');
    const timeLabels = Array.from({ length: 5 }, (_, index) => {
      const timestamp = startAt + (sessionDuration * index / 4);
      const x = xForTime(timestamp);
      return `<text x="${x}" y="${height - 5}" class="price-chart-x-label" text-anchor="middle">${formatElapsedTime(timestamp, startAt)}</text>`;
    }).join('');
    const candleWidth = Math.max(4, Math.min(14, plotWidth / Math.max(36, safeCandles.length * 2.4)));
    const candleMarks = safeCandles.map((candle) => {
      const x = xForTime(candle.startedAt);
      const openY = yForPercent(percentForPrice(candle.open));
      const closeY = yForPercent(percentForPrice(candle.close));
      const highY = yForPercent(percentForPrice(candle.high));
      const lowY = yForPercent(percentForPrice(candle.low));
      const isUp = candle.close >= candle.open;
      const colorClass = isUp ? 'is-up' : 'is-down';
      const bodyY = Math.min(openY, closeY);
      const bodyHeight = Math.max(1.5, Math.abs(closeY - openY));
      return `<g class="price-candle ${colorClass}"><line x1="${x}" y1="${highY}" x2="${x}" y2="${lowY}" /><rect x="${x - candleWidth / 2}" y="${bodyY}" width="${candleWidth}" height="${bodyHeight}" rx="1" /></g>`;
    }).join('');

    chartContainer.innerHTML = `<svg class="price-candle-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${config.subject.name} 가격 변동률 캔들 차트">${grid}${candleMarks}${timeLabels}</svg>`;
    if (chartStatus) chartStatus.textContent = candles.length > 1 ? '실시간 투자 기록 반영' : '아직 가격 변동 기록이 없습니다.';
  }

  async function refresh() {
    try {
      currentCandles = await window.PriceHistoryService.loadCandles();
      render(currentCandles);
    } catch (error) {
      render(currentCandles);
      if (chartStatus) chartStatus.textContent = error.message || '가격 이력을 불러오지 못했습니다.';
    }
  }

  async function recordInvestment(result) {
    try {
      currentCandles = await window.PriceHistoryService.recordInvestment(result);
      render(currentCandles);
    } catch (error) {
      if (chartStatus) chartStatus.textContent = error.message || '가격 차트를 갱신하지 못했습니다.';
    }
  }

  refresh();
  // [실시간 동기화] 백엔드 연결 시 모든 사용자의 투자로 생성된 최신 캔들을 주기적으로 다시 조회합니다.
  // WebSocket/SSE를 도입하면 이 10초 폴링 대신 서버 푸시 이벤트에서 refresh()를 호출하면 됩니다.
  if (hasBackendApi) window.setInterval(refresh, 10_000);
  window.addEventListener('jorong:investment-created', refresh);
  // 서버 타이머가 동기화되면 X축 전체 범위를 실제 거래 종료 시각으로 다시 계산합니다.
  window.addEventListener('jorong:market-clock-synced', refresh);
  return Object.freeze({ refresh, recordInvestment });
})();
