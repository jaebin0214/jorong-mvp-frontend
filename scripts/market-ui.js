// [거래 UI] 실제 주문 API를 붙이기 전, 방향·금액·필터의 시각 상태만 관리합니다.
window.MarketUI = (() => {
  let amount = 5000;
  const amountValue = document.querySelector('#amount-value');
  const orderButton = document.querySelector('#order-button');
  const orderTabs = [...document.querySelectorAll('[data-order]')];

  function formatAmount() {
    amountValue.textContent = `${amount.toLocaleString('ko-KR')} 크레딧`;
  }

  // [방향 선택] 옹호·조롱 버튼의 활성 색상과 주문 버튼 문구를 함께 갱신합니다.
  orderTabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      orderTabs.forEach((item) => item.classList.toggle('is-selected', item === tab));
      orderButton.textContent = tab.dataset.order === 'support' ? '옹호하기' : '조롱하기';
    });
  });

  // [금액 조절] 1,000 크레딧 단위의 임시 주문 금액을 표시합니다.
  document.querySelectorAll('[data-amount]').forEach((button) => {
    button.addEventListener('click', () => {
      amount = Math.max(1000, amount + Number(button.dataset.amount));
      formatAmount();
    });
  });

  // [목록 필터·차트 기간] MVP에서는 버튼의 선택 상태만 보여주며 데이터 필터링은 추후 연결합니다.
  document.querySelectorAll('.category-tabs, .chart-periods').forEach((group) => {
    group.querySelectorAll('button').forEach((button) => {
      button.addEventListener('click', () => {
        group.querySelectorAll('button').forEach((item) => item.classList.toggle('is-active', item === button));
      });
    });
  });

  return { formatAmount };
})();
