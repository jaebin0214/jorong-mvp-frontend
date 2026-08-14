// [내 투자 UI] 로그인 사용자별 포인트와 투자 로그를 마이페이지에 표시합니다. 실제 목록은 InvestmentService의 서버 조회 결과가 기준입니다.
(() => {
  const mypage = document.querySelector('#mypage');
  if (!mypage) return;

  const summaryItems = mypage.querySelectorAll('.my-summary > div');
  const historyCard = mypage.querySelector('.history-card');
  const totalLabel = historyCard?.querySelector('.card-title-row > span');

  function formatPoints(value) {
    return `${Number(value || 0).toLocaleString('ko-KR')} KRW`;
  }

  function formatDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '방금 전';
    return `${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getDate()).padStart(2, '0')}`;
  }

  // [포인트 요약] 로그인 API 또는 내 투자 API가 돌려준 wallet.points를 동일한 값으로 보여줍니다.
  function renderWallet(wallet) {
    const points = Number(wallet?.points);
    if (!Number.isFinite(points) || !summaryItems[0]) return;
    summaryItems[0].querySelector('b').textContent = formatPoints(points);
  }

  function createHistoryLine(investment) {
    const row = document.createElement('div');
    const side = investment.side === 'MOCK' || investment.side === 'ROAST' ? '조롱' : '옹호';
    row.className = 'history-line';
    row.append(
      Object.assign(document.createElement('span'), { textContent: formatDate(investment.createdAt) }),
      Object.assign(document.createElement('b'), { textContent: investment.targetName || window.MarketConfig.get().subject.name }),
      Object.assign(document.createElement('span'), { textContent: side, className: side === '조롱' ? 'red-text' : 'blue-text' }),
      Object.assign(document.createElement('span'), { textContent: formatPoints(investment.amount) }),
      Object.assign(document.createElement('strong'), { textContent: investment.settlementStatus || '진행 중' }),
    );
    return row;
  }

  // [투자 로그 목록] 서버가 저장한 사용자별 투자 로그만 사용하며, 빈 상태도 명시적으로 표시합니다.
  function renderInvestments(investments) {
    if (!historyCard) return;
    historyCard.querySelectorAll('.history-line, .history-empty').forEach((element) => element.remove());
    const list = Array.isArray(investments) ? investments : [];
    if (totalLabel) totalLabel.textContent = `총 ${list.length}건`;
    if (!list.length) {
      const empty = document.createElement('p');
      empty.className = 'history-empty';
      empty.textContent = '저장된 투자 내역이 없습니다.';
      historyCard.append(empty);
      return;
    }
    list.forEach((investment) => historyCard.append(createHistoryLine(investment)));
  }

  // [서버 재조회] 로그인 복원과 투자 성공 후 최신 잔액/로그를 받아와 정산 결과도 그대로 표시할 수 있게 합니다.
  async function refresh() {
    try {
      const result = await window.InvestmentService.loadMyInvestments();
      renderWallet(result.wallet);
      renderInvestments(result.investments || result.investmentLogs);
    } catch (_) {
      // 비로그인 상태나 아직 연결되지 않은 API는 기존 화면을 유지합니다.
    }
  }

  window.addEventListener('jorong:auth-session', (event) => {
    renderWallet(event.detail?.wallet);
    if (Array.isArray(event.detail?.investmentLogs)) renderInvestments(event.detail.investmentLogs);
    if (event.detail?.account) refresh();
  });
  window.addEventListener('jorong:investment-created', refresh);
  window.AccountHistoryUI = Object.freeze({ refresh });
})();
