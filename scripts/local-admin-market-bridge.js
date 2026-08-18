// [로컬 운영 연동] Supabase 미연결 개발 환경에서만 관리자 시연 저장소의 LIVE/종료 종목을 사용자 거래소 설정으로 변환합니다.
// 실제 Supabase 프로젝트에 연결되어 있으면 이 파일은 아무 데이터도 반환하지 않으므로, 배포 환경에서는 서버/DB 데이터가 항상 우선입니다.
window.LocalAdminMarketBridge = (() => {
  const ADMIN_STORE_KEY = 'jorong_admin_demo_v1';
  // [이전 REST 호환] Supabase 전환 전의 API 주소가 주입된 환경도 로컬 시연 데이터를 섞지 않습니다.
  const legacyApiBaseUrl = (window.JORONG_API_BASE_URL || '').trim();
  const isEnabled = !window.JorongSupabase && !legacyApiBaseUrl && window.JORONG_LOCAL_ADMIN_BRIDGE_ENABLED !== false;

  function readDemoStore() {
    if (!isEnabled) return null;
    try {
      const value = JSON.parse(window.localStorage.getItem(ADMIN_STORE_KEY) || 'null');
      return Array.isArray(value?.markets) ? value : null;
    } catch (_) {
      // 저장소가 차단되었거나 손상된 경우에는 기존 market-config 기본값을 그대로 사용합니다.
      return null;
    }
  }

  function getLiveMarket() {
    const store = readDemoStore();
    if (!store) return null;
    return store.markets
      .filter((market) => String(market?.status || '').toUpperCase() === 'LIVE')
      .sort((left, right) => Date.parse(right.updatedAt || right.startAt || 0) - Date.parse(left.updatedAt || left.startAt || 0))[0] || null;
  }

  // [삭제 종목 제외] 예약/초안 단계에서 ARCHIVED로 삭제한 종목은 종료 장이 아닙니다.
  // 실제로 종료·정산된 뒤 보관한 종목만 closedAt 또는 settledAt을 가지므로 정산 화면에 남깁니다.
  function isTerminalMarket(market) {
    const status = String(market?.status || '').toUpperCase();
    if (['CLOSED', 'SETTLED'].includes(status)) return true;
    return status === 'ARCHIVED' && Boolean(market?.closedAt || market?.settledAt);
  }

  // [종료 장 유지] 운영자가 타이머보다 먼저 장을 닫거나 정산 뒤 보관해도, 거래소는 대기 화면으로
  // 되돌아가지 않고 가장 최근 회차의 정산 결과를 유지해야 합니다.
  function getLatestTerminalMarket() {
    const store = readDemoStore();
    if (!store) return null;
    return store.markets
      .filter(isTerminalMarket)
      .sort((left, right) => {
        const leftTime = Date.parse(left.settledAt || left.closedAt || left.updatedAt || left.endAt || 0);
        const rightTime = Date.parse(right.settledAt || right.closedAt || right.updatedAt || right.endAt || 0);
        return rightTime - leftTime;
      })[0] || null;
  }

  // 거래 중인 장이 최우선이며, 없을 때에만 가장 최근에 닫힌 장을 정산 화면용으로 사용합니다.
  function getExchangeMarket() {
    return getLiveMarket() || getLatestTerminalMarket();
  }

  // [회차·다음 장 변경 감지] storage 이벤트가 일부 브라우저·미리보기 창에서 누락되어도
  // 현재 거래/정산 대상 종목 또는 다음 예약 시작 시각이 바뀌면 거래소 타이머를 다시 읽도록 합니다.
  function getLiveMarketSignature() {
    const market = getExchangeMarket();
    if (!market) return 'no-exchange-market';
    const nextOpenAt = getNextScheduledStart(market, readDemoStore()?.markets || []);
    return [market.id, market.status, market.startAt, market.endAt, market.closedAt, market.settledAt, market.updatedAt, market.basePrice, market.imagePath, nextOpenAt].join('|');
  }

  let loadedMarketSignature = isEnabled ? getLiveMarketSignature() : '';

  // [거래소에서도 스케줄 실행] 로컬 시연에서는 서버가 없으므로 관리자 페이지가 닫혀 있어도
  // 사용자가 보고 있는 거래소 탭이 예약 시작·마감 시각을 저장소에 반영합니다.
  async function syncLocalMarketSchedule() {
    if (!isEnabled || typeof window.AdminService?.syncMarketSchedule !== 'function') return;
    try { await window.AdminService.syncMarketSchedule(); } catch (_) { /* 다음 주기에서 재시도 */ }
  }

  function reloadIfLiveMarketChanged() {
    if (!isEnabled) return;
    const latestSignature = getLiveMarketSignature();
    if (latestSignature === loadedMarketSignature) return;
    loadedMarketSignature = latestSignature;
    // [전 회차 정산 보관] 예약 자동 시작은 이전 LIVE 장을 종료하고 다음 장을 한 번에 LIVE로 바꿉니다.
    // 새로고침 전에 현재 거래소가 이 이벤트를 받아 이전 회차 원장을 정산·사이클 리포트에 보관합니다.
    if (typeof window.dispatchEvent === 'function' && typeof CustomEvent === 'function') {
      window.dispatchEvent(new CustomEvent('jorong:admin-market-updated'));
    }
    window.location.reload();
  }

  // [다음 장 기준 시각] 수동 종료된 장은 원래 예정된 endAt이 아니라 실제 종료·정산 시각 뒤의
  // 예약을 다음 장으로 인식해야 합니다. 그래야 조기 종료 후에도 정산 화면에서 예약 타이머가 보입니다.
  function getMarketFinishedAt(currentMarket) {
    const status = String(currentMarket?.status || '').toUpperCase();
    const candidates = ['CLOSED', 'SETTLED', 'ARCHIVED'].includes(status)
      ? [currentMarket.settledAt, currentMarket.closedAt, currentMarket.endAt, currentMarket.startAt]
      : [currentMarket.endAt, currentMarket.startAt];
    return candidates.map((value) => Date.parse(value || '')).find(Number.isFinite) || NaN;
  }

  function getNextScheduledStart(currentMarket, markets) {
    const finishedAt = getMarketFinishedAt(currentMarket);
    const scheduledMarkets = markets
      .filter((market) => (
        String(market?.status || '').toUpperCase() === 'SCHEDULED'
        && Number.isFinite(Date.parse(market.startAt || ''))
      ))
      .sort((left, right) => Date.parse(left.startAt) - Date.parse(right.startAt));
    // 정상 운영에서는 종료 시각 다음의 첫 예약이 선택됩니다. 단, 로컬 시연에서 운영자가
    // 종료 시간을 수정했거나 브라우저 시계가 달라도 예약 타이머가 사라지지 않게 미래 예약을 보조로 사용합니다.
    const next = scheduledMarkets.find((market) => !Number.isFinite(finishedAt) || Date.parse(market.startAt) > finishedAt)
      || scheduledMarkets.find((market) => Date.parse(market.startAt) > Date.now())
      || scheduledMarkets[0];
    return next?.startAt || null;
  }

  // [설정 변환] 관리자 종목 레코드를 기존 거래소의 session/subject 구조로만 매핑합니다.
  // 주문·댓글·정산 데이터는 기존 회차 ID를 기준으로 각각의 로컬 서비스가 별도로 관리합니다.
  function getMarketConfigOverride(defaultConfig = {}) {
    const market = getExchangeMarket();
    if (!market) return null;

    const startAt = Date.parse(market.startAt || '');
    const endAt = Date.parse(market.endAt || '');
    if (!Number.isFinite(startAt) || !Number.isFinite(endAt) || endAt <= startAt) return null;

    const markets = readDemoStore()?.markets || [];
    const nextOpenAt = getNextScheduledStart(market, markets);
    const defaultSubject = defaultConfig.subject || {};
    const marketStatus = String(market.status || 'OPEN').toUpperCase();
    return {
      session: {
        id: String(market.id),
        startsAt: new Date(startAt).toISOString(),
        durationHours: (endAt - startAt) / (60 * 60 * 1000),
        nextOpenAt,
        // 예약 종목이 없으면 정산 화면이 임의의 다음 거래 시간을 만들지 않게 명시합니다.
        hasNextMarket: Boolean(nextOpenAt),
        // CLOSED/SETTLED/ARCHIVED 상태는 기존 종료 시각과 무관하게 즉시 정산 화면으로 전환합니다.
        status: marketStatus === 'LIVE' ? 'OPEN' : marketStatus,
      },
      subject: {
        // 관리자 종목 ID는 각 회차에서 유일하므로 로컬 댓글·투자 데이터의 종목 키로도 안전하게 사용할 수 있습니다.
        id: String(market.id),
        name: String(market.subjectName || defaultSubject.name || '오늘의 종목'),
        imagePath: String(market.imagePath || defaultSubject.imagePath || ''),
        description: String(market.description || market.shortIntroduction || defaultSubject.description || ''),
        initialPrice: Math.max(1, Math.round(Number(market.basePrice) || Number(defaultSubject.initialPrice) || 1000)),
      },
      localAdminMarket: {
        id: String(market.id),
        sequence: Number(market.sequence) || 0,
        status: marketStatus,
        commentsPublic: Boolean(market.commentsPublic),
      },
    };
  }

  // 다른 탭에서 관리자 페이지가 저장한 변경을 감지하면 거래소 탭을 새로고침해 최신 종목을 즉시 표시합니다.
  if (isEnabled) {
    window.addEventListener('storage', (event) => {
      if (event.key === ADMIN_STORE_KEY) reloadIfLiveMarketChanged();
    });
    // storage 이벤트를 지원하지 않거나 미리보기 탭에서 전달하지 않는 환경을 위한 보완입니다.
    // 시장 상태를 먼저 갱신한 뒤 변경된 회차가 있을 때만 거래소를 다시 초기화합니다.
    const syncAndReload = async () => { await syncLocalMarketSchedule(); reloadIfLiveMarketChanged(); };
    syncAndReload();
    window.setInterval?.(syncAndReload, 1500);
  }

  return Object.freeze({
    isEnabled: () => isEnabled,
    getLiveMarket,
    getLatestTerminalMarket,
    getExchangeMarket,
    getLiveMarketSignature,
    getMarketConfigOverride,
  });
})();
