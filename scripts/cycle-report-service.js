// [사이클 리포트 데이터] 개인의 시장별 정산 결과를 로컬 시연 또는 Supabase(get_my_cycle_reports RPC)에서 같은 형식으로 조회합니다.
window.CycleReportService = (() => {
  const supabaseClient = window.JorongSupabase;
  const STORAGE_PREFIX = 'jorong:cycle-report-history:v1';
  let memoryHistory = [];
  // [중복 정산 보관 방지] 리포트 화면의 여러 렌더 요청이 동시에 들어와도 같은 정산을 한 번만 보관합니다.
  let archiveCurrentSettlementTask = null;

  function createError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
  }

  // [RPC 오류 변환] Postgres RAISE EXCEPTION의 'CODE: 설명' 형태 메시지를 코드/한국어 메시지로 분리합니다.
  function parseRpcError(error, fallback) {
    const raw = String(error?.message || '').trim();
    const withDetail = raw.match(/^([A-Z][A-Z0-9_]*)\s*:\s*([\s\S]+)$/);
    if (withDetail) return createError(withDetail[1], withDetail[2].trim());
    if (/^[A-Z][A-Z0-9_]*$/.test(raw)) return createError(raw, fallback);
    return createError(undefined, raw || fallback);
  }

  async function callRpc(name, args) {
    const { data, error } = await supabaseClient.rpc(name, args);
    if (error) throw parseRpcError(error, '사이클 리포트를 불러오지 못했습니다.');
    return data || {};
  }

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
      imagePath: marketSubject.imagePath || marketSubject.imageUrl || snapshot.imagePath || configSubject.imagePath || './assets/jorong_logo.png',
    };
  }

  // [댓글 이력 결합] 로컬에서는 CommentService의 회차별 저장소를 읽고, Supabase 연결 시에는
  // get_my_cycle_reports() RPC 응답에 이미 포함된 myComments를 그대로 사용합니다(이 함수는 로컬 전용).
  function getLocalMyComments(marketId) {
    const comments = window.CommentService?.getMyCommentsForMarket?.(marketId);
    return Array.isArray(comments) ? comments : null;
  }

  function enrichLocalReportWithComments(report) {
    if (supabaseClient || !report?.market?.id) return report;
    const comments = getLocalMyComments(report.market.id);
    return comments ? { ...report, myComments: comments } : report;
  }

  // [정산 스냅샷 정규화] 로컬 InvestmentService 결과와 get_my_cycle_reports() RPC 응답의 필드 차이를 리포트용 구조로 통일합니다.
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
      myComments: Array.isArray(snapshot.myComments) ? snapshot.myComments : (Array.isArray(snapshot.comments) ? snapshot.comments : []),
      settledAt: settlement.settledAt || snapshot.settledAt || market.settledAt || market.closeAt || new Date().toISOString(),
    };
  }

  function sortByLatest(reports) {
    return [...reports].sort((left, right) => Date.parse(right.settledAt || 0) - Date.parse(left.settledAt || 0));
  }

  function archiveSnapshot(snapshot) {
    if (supabaseClient || !getStorageKey()) return null;
    const report = enrichLocalReportWithComments(normalizeReport(snapshot));
    if (!report) return null;
    const history = readLocalHistory();
    const index = history.findIndex((item) => String(item.market?.id) === report.market.id);
    // 같은 정산 스냅샷은 다시 저장하거나 갱신 이벤트를 발생시키지 않습니다.
    // 그렇지 않으면 "리포트 로드 → 정산 보관 → 리포트 갱신"이 무한 반복될 수 있습니다.
    if (index >= 0 && JSON.stringify(history[index]) === JSON.stringify(report)) return history[index];
    if (index >= 0) history[index] = report;
    else history.push(report);
    const sorted = sortByLatest(history);
    writeLocalHistory(sorted);
    window.dispatchEvent(new CustomEvent('jorong:cycle-report-updated', { detail: { reports: sorted } }));
    return report;
  }

  // [현재 장 반영] 로컬 시연에서는 장이 끝난 뒤 리포트를 열 때도 종료 정산을 한 번 저장해 누락을 막습니다.
  // Supabase 연결 시에는 settle_market()이 이미 서버에 정산을 저장해두므로 이 보관 작업이 필요 없습니다.
  async function archiveCurrentSettlementWhenClosed() {
    if (supabaseClient || !window.MarketCountdown?.isEnded?.() || !window.InvestmentService?.loadSettlement) return;
    if (archiveCurrentSettlementTask) return archiveCurrentSettlementTask;
    archiveCurrentSettlementTask = (async () => {
      const snapshot = await window.InvestmentService.loadSettlement();
      archiveSnapshot(snapshot);
    })();
    try {
      await archiveCurrentSettlementTask;
    } finally {
      archiveCurrentSettlementTask = null;
    }
  }

  async function requestReports() {
    const body = await callRpc('get_my_cycle_reports', {});
    const rawReports = Array.isArray(body.reports) ? body.reports : [];
    return sortByLatest(rawReports.map(normalizeReport).filter(Boolean));
  }

  async function loadReports() {
    if (!getAccount()) return [];
    if (supabaseClient) return requestReports();
    await archiveCurrentSettlementWhenClosed();
    const history = readLocalHistory();
    const enriched = sortByLatest(history.map(enrichLocalReportWithComments));
    // CommentService가 늦게 초기화된 뒤에도 기존 정산 카드에 내 댓글 이력을 보완해 저장합니다.
    if (JSON.stringify(history) !== JSON.stringify(enriched)) writeLocalHistory(enriched);
    return enriched;
  }

  window.addEventListener('jorong:market-settled', (event) => archiveSnapshot(event.detail));
  window.addEventListener('jorong:comments-changed', () => {
    if (!supabaseClient && window.MarketCountdown?.isEnded?.()) archiveCurrentSettlementWhenClosed().catch(() => {});
  });
  // 새로고침 직후에는 정산 이벤트가 인증 복원보다 먼저 발생할 수 있습니다.
  // 계정이 복원된 뒤 현재 종료 장을 다시 보관해 개인 리포트가 사라지지 않게 합니다.
  window.addEventListener('jorong:auth-session', (event) => {
    memoryHistory = [];
    if (!supabaseClient && event.detail?.account) archiveCurrentSettlementWhenClosed().catch(() => {});
  });

  return Object.freeze({ loadReports, archiveSnapshot, normalizeReport });
})();
