// [항목 가치 UI] 투자 처리 결과의 현재 가치와 직전 변동값을 화면에 반영합니다.
(() => {
  const valueLabel = document.querySelector('#exchange-current-price');
  const valuePin = document.querySelector('#exchange-price-pin');
  const changeLabel = document.querySelector('#exchange-price-change');
  const mobileValueLabel = document.querySelector('#mobile-current-price');
  const mobileChangeLabel = document.querySelector('#mobile-price-change');

  // [변동률] 직전 가격 대비 변동 금액의 비율을 계산해 금액 옆 괄호 안에 표시합니다.
  function formatChangeRate(value, valueChange, previousValue) {
    const baseValue = Number.isFinite(previousValue) && previousValue > 0
      ? previousValue
      : value - valueChange;
    const rate = baseValue > 0 ? (valueChange / baseValue) * 100 : 0;
    const sign = rate > 0 ? '+' : '';

    return `${sign}${rate.toFixed(2)}%`;
  }

  function update({ value, valueChange, previousValue }) {
    const formattedValue = value.toLocaleString('ko-KR');
    const formattedChange = `${valueChange > 0 ? '+' : ''}${valueChange.toLocaleString('ko-KR')} KRW (${formatChangeRate(value, valueChange, previousValue)})`;

    if (valueLabel) valueLabel.textContent = `${formattedValue} KRW`;
    if (valuePin) valuePin.textContent = formattedValue;
    if (changeLabel) {
      changeLabel.textContent = formattedChange;
      changeLabel.classList.toggle('is-up', valueChange > 0);
      changeLabel.classList.toggle('is-down', valueChange < 0);
    }
    // [모바일 종목 요약] 데스크톱 차트 제목의 가격 변화와 정확히 같은 값을 표시합니다.
    if (mobileValueLabel) mobileValueLabel.textContent = `${formattedValue} KRW`;
    if (mobileChangeLabel) {
      mobileChangeLabel.textContent = formattedChange;
      mobileChangeLabel.classList.toggle('is-up', valueChange > 0);
      mobileChangeLabel.classList.toggle('is-down', valueChange < 0);
    }
  }

  window.TargetValueUI = Object.freeze({ update });
})();
