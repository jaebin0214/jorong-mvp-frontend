// [사이클 리포트 데이터] 개인의 시장별 정산 결과를 로컬 시연 또는 서버 API에서 같은 형식으로 조회합니다.
window.CycleReportService = (() => {
  const API_BASE_URL = (window.JORONG_API_BASE_URL || '').replace(/\/$/, '');
  const STORAGE_PREFIX = 'jorong:cycle-report-history:v1';
  let memoryHistory = [];

  function getAccount() {
    return window.AuthService?.getCurrentAccount?.() || null;
  }

  // [사용자별 보관] 한 브라우저를 여러 계정이 사용해도 리포트가 섞이지 않도록 계정 식별자를 저장소 키에 사용합니다.
  function getStorageKey() {
    const account = getAccount();
    return account?.id || account?.nickname ? `${STORAGE_PREFIX}:${String(account.id || account.nickname)}` : null;
  }

  function readLocalHistory() {
    const key = getStorageKey();
    if (!key) return [];
    if (Array.isArray(memoryHistory) && memoryHistory.length) return [...memoryHistory];
    try {
      const saved = JSON.parse(window.localStorage.getItem(key) || '[]');
      memoryHistory = Array.isArray(saved) ? saved : [];
    } catch (_) {
      memoryHistory = [];
    }
    return [...memoryHistory];
  }

  function writeLocalHistory(history) {
    memoryHistory = Array.isArray(history) ? history : [];
    const key = getStorageKey();
    if (!key) return;
    try { window.localStorage.setItem(key, JSON.stringify(memoryHistory)); } catch (_) { /* 저장 제한 시 현재 접속 중인 메모리 목록을 유지합니다. */ }
  }

  function getSubjectFromSnapshot(snapshot = {}) {
    const configSubject = window.MarketConfig?.get?.().subject || {};
    const marketSubject = snapshot.subject || snapshot.market?.subject || snapshot.target || {};
    return {
      id: marketSubject.id || configSubject.id || '',
      name: marketSubject.name || marketSubject.subjectName || snapshot.targetName || configSubject.name || '오늘의 종목',
      imagePath: marketSubject.imagePath || marketSubject.imageUrl || snapshot.imagePath || configSubject.imagePath || './assets/hoon.png',
    };
  }

  // [정산 스냅샷 정규화] 로컬 InvestmentService 결과와 백엔드 응답의 필드 차이를 리포트용 구조로 통일합니다.
  function normalizeReport(snapshot = {}) {
    const market = snapshot.market || snapshot.session || {};
    const settlement = snapshot.settlement || snapshot.result || {};
    const position = snapshot.position || snapshot.investmentPosition || null;
    const subject = getSubjectFromSnapshot(snapshot);
    const marketId = String(snapshot.marketId || market.id || settlement.marketId || '');
    if (!marketId || !position || !settlement) return null;
    return {
      id: String(snapshot.id || settlement.id || `settlement-${marketId}`),
      market: {
        id: marketId,
        status: market.status || 'SETTLED',
        closePrice: market.closePrice ?? settlement.closePrice ?? snapshot.closePrice ?? '0',
        closeAt: market.closeAt || snapshot.closeAt || settlement.settledAt || null,
      },
      subject,
      position,
      settlement,
      wallet: snapshot.wallet || {},
      marketSummary: snapshot.marketSummary || market.summary || snapshot.summary || {},
      settledAt: settlement.settledAt || snapshot.settledAt || market.settledAt || market.closeAt || new Date().toISOString(),
    };
  }

  function sortByLatest(reports) {
    return [...reports].sort((left, right) => Date.parse(right.settledAt || 0) - Date.parse(left.settledAt || 0));
  }

  function archiveSnapshot(snapshot) {
    if (API_BASE_URL || !getStorageKey()) return null;
    const report = normalizeReport(snapshot);
    if (!report) return null;
    const history = readLocalHistory();
    const index = history.findIndex((item) => String(item.market?.id) === report.market.id);
    if (index >= 0) history[index] = report;
    else history.push(report);
    const sorted = sortByLatest(history);
    writeLocalHistory(sorted);
    window.dispatchEvent(new CustomEvent('jorong:cycle-report-updated', { detail: { reports: sorted } }));
    return report;
  }

  // [현재 장 반영] 로컬 시연에서는 장이 끝난 뒤 리포트를 열 때도 종료 정산을 한 번 저장해 누락을 막습니다.
  async function archiveCurrentSettlementWhenClosed() {
    if (API_BASE_URL || !window.MarketCountdown?.isEnded?.() || !window.InvestmentService?.loadSettlement) return;
    const snapshot = await window.InvestmentService.loadSettlement();
    archiveSnapshot(snapshot);
  }

  async function requestReports() {
    const response = await fetch(`${API_BASE_URL}/me/cycle-reports`, {
      credentials: 'include',
      headers: { Accept: 'application/json', ...(window.AuthService?.getRequestHeaders?.() || {}) },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload.message || '사이클 리포트를 불러오지 못했습니다.');
      error.code = payload.code || 'CYCLE_REPORT_REQUEST_FAILED';
      throw error;
    }
    const rawReports = payload.reports || payload.items || payload.settlements || [];
    return sortByLatest(rawReports.map(normalizeReport).filter(Boolean));
  }

  async function loadReports() {
    if (!getAccount()) return [];
    if (API_BASE_URL) return requestReports();
    await archiveCurrentSettlementWhenClosed();
    return sortByLatest(readLocalHistory());
  }

  window.addEventListener('jorong:market-settled', (event) => archiveSnapshot(event.detail));
  window.addEventListener('jorong:auth-session', () => { memoryHistory = []; });

  return Object.freeze({ loadReports, archiveSnapshot, normalizeReport });
})();
