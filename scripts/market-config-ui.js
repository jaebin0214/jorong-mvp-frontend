// [운영 설정 UI] 중앙 설정값을 거래소의 종목 이미지·이름·초기 가격 표시에 반영합니다.
(() => {
  const config = window.MarketConfig.get();
  const { subject } = config;
  const marketAvailable = config.marketAvailable === true;
  // [종료 장 우선] LIVE 종목이 사라졌더라도 직전 장의 CLOSED/SETTLED/ARCHIVED 설정이 있으면
  // 거래소 본문 대신 정산 화면으로 이어져야 합니다.
  const isTerminalMarket = ['CLOSED', 'SETTLED', 'ARCHIVED'].includes(String(config.session?.status || '').toUpperCase());
  const exchangeRebuild = document.querySelector('.exchange-rebuild');
  // 활성 장이 없으면 거래소 본문을 비워 두며, 별도의 대기 안내 화면은 표시하지 않습니다.
  // 종료 장은 아래 정산 UI가 즉시 표시합니다.
  if (exchangeRebuild) exchangeRebuild.hidden = !marketAvailable || isTerminalMarket;
  if (!marketAvailable) {
    window.dispatchEvent(new CustomEvent('jorong:market-config-updated', { detail: config }));
    return;
  }
  const formattedPrice = subject.initialPrice.toLocaleString('ko-KR');
  const subjectImage = document.querySelector('.exchange-subject-image');

  // 종목명은 거래소 본문에서 반복되는 두 위치를 함께 교체합니다.
  document.querySelectorAll('.exchange-subject-card > b, .exchange-chart-title > b, #mobile-subject-name, #mobile-comment-subject-name').forEach((element) => {
    element.textContent = subject.name;
  });

  // 운영자가 assets 폴더에 넣은 이미지를 설정 경로대로 불러오고 대체 텍스트도 맞춥니다.
  if (subjectImage) {
    subjectImage.src = subject.imagePath;
    subjectImage.alt = `오늘의 종목 ${subject.name}`;
  }

  // 투자 전 화면은 설정된 초기 가격과 0% 변동 상태로 표시합니다.
  const currentPrice = document.querySelector('#exchange-current-price');
  const pricePin = document.querySelector('#exchange-price-pin');
  const priceChange = document.querySelector('#exchange-price-change');
  if (currentPrice) currentPrice.textContent = `${formattedPrice} 크레딧`;
  if (pricePin) pricePin.textContent = formattedPrice;
  if (priceChange) {
    priceChange.textContent = '0 크레딧 (0.00%)';
    priceChange.classList.remove('is-up', 'is-down');
  }
  const mobilePrice = document.querySelector('#mobile-current-price');
  const mobileChange = document.querySelector('#mobile-price-change');
  if (mobilePrice) mobilePrice.textContent = `${formattedPrice} 크레딧`;
  if (mobileChange) {
    mobileChange.textContent = '0 크레딧 (0.00%)';
    mobileChange.classList.remove('is-up', 'is-down');
  }
  window.dispatchEvent(new CustomEvent('jorong:market-config-updated', { detail: config }));
})();
