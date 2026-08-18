// [항목 가치 UI] 투자 처리 결과의 현재 가치와 최초 가격 대비 변동값을 화면에 반영합니다.
(() => {
  const valueLabel = document.querySelector('#exchange-current-price');
  const valuePin = document.querySelector('#exchange-price-pin');
  const changeLabel = document.querySelector('#exchange-price-change');
  const mobileValueLabel = document.querySelector('#mobile-current-price');
  const mobileChangeLabel = document.querySelector('#mobile-price-change');

  // [최초가격 기준] 주문 직전 가격이 아니라 운영자가 개장 때 정한 기준가를 사용합니다.
  // RPC·SQL 원본·기존 프론트 응답이 혼재해도 base_price/basePrice/initialPrice를 모두 허용합니다.
  function getInitialPrice(target = {}) {
    const targetInitialPrice = Number(
      target.initialPrice
      ?? target.initial_price
      ?? target.basePrice
      ?? target.base_price,
    );
    if (Number.isFinite(targetInitialPrice) && targetInitialPrice > 0) return targetInitialPrice;

    const chartInitialPrice = Number(window.PriceHistoryService?.getInitialPrice?.());
    if (Number.isFinite(chartInitialPrice) && chartInitialPrice > 0) return chartInitialPrice;

    const configuredInitialPrice = Number(window.MarketConfig?.get?.().subject?.initialPrice);
    return Number.isFinite(configuredInitialPrice) && configuredInitialPrice > 0 ? configuredInitialPrice : 1;
  }

  function formatChangeRate(valueChange, initialPrice) {
    const rate = initialPrice > 0 ? (valueChange / initialPrice) * 100 : 0;
    const sign = rate > 0 ? '+' : '';

    return `${sign}${rate.toFixed(2)}%`;
  }

  function update(target = {}) {
    const value = Number(target.value ?? target.currentPrice);
    if (!Number.isFinite(value) || value <= 0) return;

    const initialPrice = getInitialPrice(target);
    const valueChange = value - initialPrice;
    const formattedValue = value.toLocaleString('ko-KR');
    const formattedChange = `${valueChange > 0 ? '+' : ''}${valueChange.toLocaleString('ko-KR')} 크레딧 (${formatChangeRate(valueChange, initialPrice)})`;

    if (valueLabel) valueLabel.textContent = `${formattedValue} 크레딧`;
    if (valuePin) valuePin.textContent = formattedValue;
    if (changeLabel) {
      changeLabel.textContent = formattedChange;
      changeLabel.classList.toggle('is-up', valueChange > 0);
      changeLabel.classList.toggle('is-down', valueChange < 0);
    }
    // [모바일 종목 요약] 데스크톱 차트 제목의 가격 변화와 정확히 같은 값을 표시합니다.
    if (mobileValueLabel) mobileValueLabel.textContent = `${formattedValue} 크레딧`;
    if (mobileChangeLabel) {
      mobileChangeLabel.textContent = formattedChange;
      mobileChangeLabel.classList.toggle('is-up', valueChange > 0);
      mobileChangeLabel.classList.toggle('is-down', valueChange < 0);
    }
  }

  window.TargetValueUI = Object.freeze({ update });
})();
