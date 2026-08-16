// [실시간 캔들 차트] 투자 주문마다 하나의 캔들을 만들고, 모든 고가·저가를 포함하는 고정 SVG 좌표계에 그립니다.
window.PriceChartUI = (() => {
  const chartContainer = document.querySelector('.exchange-chart');
  const chartStatus = document.querySelector('#exchange-chart-status');
  const config = window.MarketConfig.get();
  const hasBackendApi = Boolean((window.JORONG_API_BASE_URL || '').trim());
  const initialPrice = Number(config.subject.initialPrice);
  // [운영 종목 기준선] 가격 변동의 중앙 기준선은 운영자가 개설 시 정한 최초 가격입니다.
  // 종목마다 기준 가격이 달라도 같은 방식으로 5개 눈금과 50 KRW 단위를 유지합니다.
  const priceBaseline = Math.max(1, Number(config.subject.initialPrice) || 1000);
  const priceGridUnit = 50;
  const gridLineCount = 5;
  // SVG의 가상 좌표계 크기는 고정합니다. 가격 범위만 매 렌더링마다 자동 보정합니다.
  const width = 900;
  const height = 400;
  // [축 여백] 왼쪽은 실제 가격(KRW) 라벨, 위쪽은 축 제목을 위한 공간입니다.
  const padding = { top: 40, right: 10, bottom: 10, left: 70 };
  const volumeHeight = 48;
  let currentCandles = [];

  function formatElapsedTime(timestamp, startAt) {
    const totalMinutes = Math.max(0, Math.round((timestamp - startAt) / 60_000));
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return `${hours}:${String(minutes).padStart(2, '0')}`;
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  // [세로축 표시값] 내부 값은 소수점을 유지하고, 축에서는 숫자만 간결하게 표시합니다.
  function formatPrice(value) {
    return Math.round(Number(value) || 0).toLocaleString('ko-KR');
  }

  // [Y축 자동 보정] 개설 시 설정한 최초 가격 기준선은 차트 중앙에 고정합니다.
  // 최고·최저가가 범위를 벗어날 때만 위·아래 범위를 같은 비율로 확장합니다.
  // 화면의 가로 기준선은 언제나 5개이며, 모든 라벨은 50 KRW의 배수입니다.
  function getPriceDomain(candles) {
    const values = candles
      .flatMap((candle) => [candle.open, candle.high, candle.low, candle.close])
      .map(Number)
      .filter((value) => Number.isFinite(value) && value > 0);
    const largestDistance = Math.max(
      priceGridUnit,
      ...values.map((value) => Math.abs(value - priceBaseline)),
    );
    const stepsPerSide = (gridLineCount - 1) / 2;
    // 범위가 넓어지면 눈금 간격도 50의 배수로만 키워, 캔들이 영역 밖으로 나가지 않게 합니다.
    const gridStep = Math.ceil(largestDistance / stepsPerSide / priceGridUnit) * priceGridUnit;
    const min = Math.max(0, priceBaseline - (stepsPerSide * gridStep));
    const max = priceBaseline + (stepsPerSide * gridStep);
    const gridValues = Array.from(
      { length: gridLineCount },
      (_, index) => max - (index * gridStep),
    );
    return { min, max, gridValues, gridStep };
  }

  // [X축 최소 간격] 같은 분에 발생한 추가 투자도 서로 가려지지 않도록 시간 순서를 유지한 채 간격을 보장합니다.
  function getCandleXPositions(candles, startAt, endAt, plotLeft, plotWidth) {
    const duration = Math.max(1, endAt - startAt);
    const plotRight = plotLeft + plotWidth;
    const minimumGap = Math.min(13, Math.max(5, plotWidth / Math.max(48, candles.length * 2.6)));
    const positions = [];

    candles.forEach((candle, index) => {
      const timeX = plotLeft + ((clamp(candle.startedAt, startAt, endAt) - startAt) / duration) * plotWidth;
      const previousX = positions[index - 1];
      positions.push(index === 0 ? timeX : Math.max(timeX, previousX + minimumGap));
    });

    // 장 마감 근처의 주문이 많아 영역 밖으로 밀린 경우에는 순서를 유지한 채 차트 너비에 다시 배치합니다.
    if (positions.length > 1 && positions.at(-1) > plotRight) {
      return candles.map((_, index) => plotLeft + ((index + 1) / (candles.length + 1)) * plotWidth);
    }
    return positions.map((position) => clamp(position, plotLeft, plotRight));
  }

  function render(candles) {
    if (!chartContainer) return;
    const { startAt, endAt } = window.PriceHistoryService.getSessionRange();
    const safeCandles = candles.length
      ? candles.filter((candle) => [candle.open, candle.high, candle.low, candle.close].every((value) => Number.isFinite(Number(value)) && Number(value) > 0))
      : [];
    const fallbackCandle = { startedAt: startAt, endedAt: startAt, open: initialPrice, high: initialPrice, low: initialPrice, close: initialPrice, volume: 0 };
    const displayCandles = safeCandles.length ? safeCandles : [fallbackCandle];
    const plotLeft = padding.left;
    const plotRight = width - padding.right;
    const priceTop = padding.top;
    const priceBottom = height - padding.bottom - volumeHeight;
    const plotWidth = plotRight - plotLeft;
    const priceHeight = priceBottom - priceTop;
    const domain = getPriceDomain(displayCandles);
    const yForPrice = (price) => priceTop + ((domain.max - Number(price)) / (domain.max - domain.min)) * priceHeight;
    const xPositions = getCandleXPositions(displayCandles, startAt, endAt, plotLeft, plotWidth);
    const maxVolume = Math.max(1, ...displayCandles.map((candle) => Number(candle.volume) || 0));
    const volumeBottom = height - padding.bottom;
    const candleWidth = Math.max(4, Math.min(12, plotWidth / Math.max(70, displayCandles.length * 2.8)));

    // [가격 기준값] 최초 가격 기준선과 그 위·아래의 50 KRW 단위 가격만 5개 표시합니다.
    const grid = domain.gridValues.map((price) => {
      const y = yForPrice(price);
      const isBaseline = price === priceBaseline;
      return `<line x1="${plotLeft}" y1="${y}" x2="${plotRight}" y2="${y}" class="price-chart-grid${isBaseline ? ' is-baseline' : ''}" /><text x="${plotLeft - 9}" y="${y + 4}" class="price-chart-y-label${isBaseline ? ' is-baseline' : ''}" text-anchor="end">${formatPrice(price)}</text>`;
    }).join('');

    const volumeBars = displayCandles.map((candle, index) => {
      const volume = Number(candle.volume) || 0;
      const barHeight = volume ? Math.max(4, (volume / maxVolume) * volumeHeight) : 3;
      return `<rect class="price-volume-bar" x="${xPositions[index] - candleWidth / 2}" y="${volumeBottom - barHeight}" width="${candleWidth}" height="${barHeight}" rx="1" />`;
    }).join('');

    const candleMarks = displayCandles.map((candle, index) => {
      const openY = yForPrice(candle.open);
      const closeY = yForPrice(candle.close);
      const isSupport = Number(candle.close) >= Number(candle.open);
      const bodyY = Math.min(openY, closeY);
      const bodyHeight = Math.max(2, Math.abs(closeY - openY));
      // [캔들 표현] 요청에 따라 고가·저가를 잇는 가운데 꼬리선은 화면에 그리지 않습니다.
      // high·low 값은 차트 범위를 안전하게 계산하기 위해 계속 보관합니다.
      return `<g class="price-candle ${isSupport ? 'is-support' : 'is-mock'}"><rect x="${xPositions[index] - candleWidth / 2}" y="${bodyY}" width="${candleWidth}" height="${bodyHeight}" rx="1" /></g>`;
    }).join('');

    const timeLabels = Array.from({ length: 3 }, (_, index) => {
      const timestamp = startAt + ((endAt - startAt) * index / 2);
      const x = plotLeft + (plotWidth * index / 2);
      return `<text x="${x}" y="${height - 8}" class="price-chart-x-label" text-anchor="${index === 0 ? 'start' : index === 2 ? 'end' : 'middle'}">${formatElapsedTime(timestamp, startAt)}</text>`;
    }).join('');

    chartContainer.innerHTML = `<svg class="price-candle-chart" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="${config.subject.name} 실시간 캔들 차트"><text x="${plotLeft}" y="14" class="price-chart-axis-title">가격 (KRW)</text>${grid}${volumeBars}${candleMarks}${timeLabels}</svg>`;
    if (chartStatus) chartStatus.textContent = candles.length ? '실시간 투자 기록 반영' : '첫 투자를 기다리고 있습니다.';
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
      // 서버 모드에서는 즉시 표시 후, 서버 집계 데이터로 한 번 더 동기화합니다.
      if (hasBackendApi) window.setTimeout(refresh, 1_000);
    } catch (error) {
      if (chartStatus) chartStatus.textContent = error.message || '가격 차트를 갱신하지 못했습니다.';
    }
  }

  refresh();
  // 서버 연결 시에는 DB 집계값을, 로컬 시연에서는 다른 계정/탭이 남긴 공유 원장 값을 주기적으로 읽습니다.
  window.setInterval(refresh, hasBackendApi ? 10_000 : 1_500);
  window.addEventListener('storage', (event) => {
    const localOrderStoreKey = window.InvestmentService?.getLocalStoreKey?.();
    if (!hasBackendApi && event.key === localOrderStoreKey) refresh();
  });
  window.addEventListener('jorong:investment-created', (event) => {
    if (!event.detail?.order && !event.detail?.investment) refresh();
  });
  window.addEventListener('jorong:market-clock-synced', refresh);
  return Object.freeze({ refresh, recordInvestment });
})();
