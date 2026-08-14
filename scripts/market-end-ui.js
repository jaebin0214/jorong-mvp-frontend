// [거래 종료 UI] 카운트다운 종료 시 거래 대상, 가격 차트, 투자 카드를 하나의 레이어로 비활성화합니다.
(() => {
  const focusGrid = document.querySelector('.exchange-focus-grid');

  // [종료 레이어 생성] HTML 구조를 단순하게 유지하면서 거래 영역 안에 종료 안내를 추가합니다.
  function getOverlay() {
    if (!focusGrid) return null;

    let overlay = document.querySelector('#market-ended-overlay');
    if (overlay) return overlay;

    overlay = document.createElement('div');
    overlay.id = 'market-ended-overlay';
    overlay.className = 'market-ended-overlay';
    overlay.setAttribute('role', 'status');
    overlay.setAttribute('aria-live', 'polite');
    overlay.hidden = true;

    const message = document.createElement('p');
    message.textContent = '거래가 종료되었습니다.';
    overlay.append(message);
    focusGrid.append(overlay);
    return overlay;
  }

  // [종료 상태 반영] 화면 위 안내를 표시하고 거래에 쓰이는 입력 요소를 비활성화합니다.
  function showEndedState() {
    // [정산 결과 우선] 새 정산 화면이 준비되어 있으면 기존 딤 오버레이 대신 해당 화면으로 전환합니다.
    if (window.MarketSettlementUI) {
      window.MarketSettlementUI.show();
      return;
    }
    const overlay = getOverlay();
    if (!focusGrid || !overlay || focusGrid.classList.contains('is-market-ended')) return;

    focusGrid.classList.add('is-market-ended');
    focusGrid.setAttribute('aria-label', '거래 종료됨');
    overlay.hidden = false;

    // 키보드 조작으로 종료된 투자 요청이 시도되지 않도록 투자 카드의 컨트롤도 잠급니다.
    focusGrid.querySelectorAll('.exchange-roast-card button, .exchange-roast-card input').forEach((control) => {
      control.disabled = true;
    });
  }

  window.addEventListener('jorong:market-ended', showEndedState);

  // 재접속했을 때 이미 종료된 회차라면 이벤트를 놓치지 않고 즉시 종료 화면을 표시합니다.
  if (window.MarketCountdown?.isEnded()) showEndedState();

  window.MarketEndUI = Object.freeze({ showEndedState });
})();
