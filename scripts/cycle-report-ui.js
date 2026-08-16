// [사이클 리포트 UI] 각 회차의 개인 정산 데이터를 기존 정산 결과와 같은 카드 구성으로 렌더링합니다.
(() => {
  const view = document.querySelector('#cycle-report');
  const list = document.querySelector('#cycle-report-list');
  const empty = document.querySelector('#cycle-report-empty');
  const errorBox = document.querySelector('#cycle-report-error');
  const math = window.FinancialMath;

  if (!view || !list || !empty || !errorBox || !math || !window.CycleReportService) return;

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function formatKrw(value) {
    try { return math.formatKrwUnsigned(String(value ?? '0'), 0); } catch (_) { return '0 KRW'; }
  }

  function formatPrice(value) {
    try { return math.formatPrice(String(value ?? '0')); } catch (_) { return '0 KRW'; }
  }

  function formatPnl(value) {
    try { return math.formatKrw(String(value ?? '0')); } catch (_) { return '0 KRW'; }
  }

  function formatRate(value) {
    try { return math.formatRate(String(value ?? '0')); } catch (_) { return '0.00%'; }
  }

  function formatDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '정산 완료';
    return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getDate()).padStart(2, '0')} 정산 완료`;
  }

  function getOutcome(realizedPnl) {
    const pnl = String(realizedPnl ?? '0');
    if (pnl.startsWith('-')) return { label: '예측 실패', className: 'is-failure' };
    if (Number(pnl) > 0) return { label: '예측 성공', className: '' };
    return { label: '변동 없음', className: 'is-neutral' };
  }

  function getSideLabel(side) {
    return String(side).toUpperCase() === 'MOCK' || String(side).toUpperCase() === 'ROAST' ? '조롱' : '옹호';
  }

  function addMetric(container, label, value) {
    const metric = element('div');
    metric.append(element('span', '', label), element('b', '', value));
    container.append(metric);
  }

  function createReportCard(report) {
    const position = report.position || {};
    const settlement = report.settlement || {};
    const market = report.market || {};
    const summary = report.marketSummary || {};
    const realizedPnl = settlement.realizedPnl ?? '0';
    const outcome = getOutcome(realizedPnl);
    const side = getSideLabel(position.side);
    const supportRatio = Math.max(0, Math.min(100, Number(summary.supportRatio) || 0));
    const mockRatio = Math.max(0, Math.min(100, Number(summary.mockRatio) || 0));
    const card = element('article', 'cycle-report-card');
    const heading = element('header', 'cycle-report-card-heading');
    const headingCopy = element('div');
    const sideBadge = element('b', `cycle-report-side is-${side === '옹호' ? 'support' : 'mock'}`, `${side} 참여`);
    headingCopy.append(element('span', '', formatDate(report.settledAt)), element('h2', '', report.subject?.name || '오늘의 종목'));
    heading.append(headingCopy, sideBadge);

    const row = element('div', 'cycle-report-settlement-row');
    const subjectCard = element('section', 'settlement-subject-card');
    const image = element('img');
    image.src = report.subject?.imagePath || './assets/hoon.png';
    image.alt = `${report.subject?.name || '종목'} 이미지`;
    subjectCard.append(image, element('b', '', `오늘의 종목 · ${report.subject?.name || '종목'}`), element('span', '', `마감 가격 ${formatPrice(market.closePrice ?? settlement.closePrice)}`));

    const resultCard = element('section', 'settlement-result-card');
    const resultHeader = element('header');
    const outcomeBadge = element('b', outcome.className, outcome.label);
    resultHeader.append(element('h2', '', '내 정산 결과'), outcomeBadge);
    const pnl = element('div', 'settlement-pnl');
    const pnlValue = element('strong', String(realizedPnl).startsWith('-') ? 'is-loss' : '', `${formatPnl(realizedPnl)} (${formatRate(settlement.pnlRate)})`);
    pnl.append(element('span', '', '최종 실현손익'), pnlValue);
    const metrics = element('div', 'settlement-metrics');
    addMetric(metrics, '총 투자금', formatKrw(position.totalInvestment));
    addMetric(metrics, '평균 단가', formatPrice(position.averagePrice));
    addMetric(metrics, '최종 가격', formatPrice(settlement.closePrice ?? market.closePrice));
    addMetric(metrics, '보유 수량', math.formatQuantity(position.quantity || '0'));
    const payout = element('div', 'settlement-payout');
    const payoutCopy = element('div');
    payoutCopy.append(element('b', '', '정산 지급액'), element('span', '', `정산 후 보유 · ${formatKrw(settlement.balanceAfterSettlement ?? report.wallet?.points)}`));
    payout.append(payoutCopy, element('strong', '', formatKrw(settlement.settlementAmount)));
    resultCard.append(resultHeader, pnl, metrics, payout);
    row.append(subjectCard, resultCard);

    const finalSummary = element('article', 'market-final-summary cycle-report-market-summary');
    const summaryCopy = element('div');
    summaryCopy.append(element('h2', '', '최종 시장 결과'), element('p', '', `총 거래량 ${formatKrw(summary.totalVolume)} · 참여 ${Number(summary.participants) || 0}명`));
    const ratio = element('div', 'market-ratio');
    const ratioLabels = element('div');
    ratioLabels.append(element('b', '', `옹호 ${supportRatio.toFixed(0)}%`), element('b', '', `조롱 ${mockRatio.toFixed(0)}%`));
    const ratioBar = element('span');
    const supportBar = element('i', 'cycle-report-support-bar');
    const mockBar = element('i', 'cycle-report-mock-bar');
    supportBar.style.width = `${supportRatio}%`;
    mockBar.style.width = `${mockRatio}%`;
    ratioBar.append(supportBar, mockBar);
    ratio.append(ratioLabels, ratioBar);
    finalSummary.append(summaryCopy, ratio);
    card.append(heading, row, finalSummary);
    return card;
  }

  async function render() {
    list.replaceChildren();
    empty.hidden = true;
    errorBox.hidden = true;
    try {
      const reports = await window.CycleReportService.loadReports();
      if (!reports.length) {
        empty.hidden = false;
        return;
      }
      reports.forEach((report) => list.append(createReportCard(report)));
    } catch (error) {
      errorBox.textContent = error.message || '사이클 리포트를 불러오지 못했습니다.';
      errorBox.hidden = false;
    }
  }

  window.addEventListener('jorong:view-changed', (event) => {
    if (event.detail?.viewId === 'cycle-report') render();
  });
  window.addEventListener('jorong:cycle-report-updated', () => {
    if (view.classList.contains('is-active')) render();
  });
  window.addEventListener('jorong:auth-session', (event) => {
    if (event.detail?.account && view.classList.contains('is-active')) render();
  });

  window.CycleReportUI = Object.freeze({ render });
})();
