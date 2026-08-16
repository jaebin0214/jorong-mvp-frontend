// [로컬 운영 연동] API 미연결 개발 환경에서만 관리자 시연 저장소의 LIVE 종목을 사용자 거래소 설정으로 변환합니다.
// 실제 API 주소가 있으면 이 파일은 아무 데이터도 반환하지 않으므로, 배포 환경에서는 서버/DB 데이터가 항상 우선입니다.
window.LocalAdminMarketBridge = (() => {
  const ADMIN_STORE_KEY = 'jorong_admin_demo_v1';
  const API_BASE_URL = (window.JORONG_API_BASE_URL || '').trim();
  const isEnabled = !API_BASE_URL && window.JORONG_LOCAL_ADMIN_BRIDGE_ENABLED !== false;

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

  // [회차·다음 장 변경 감지] storage 이벤트가 일부 브라우저·미리보기 창에서 누락되어도
  // 현재 LIVE 종목 또는 다음 예약 시작 시각이 바뀌면 거래소 타이머를 다시 읽도록 합니다.
  function getLiveMarketSignature() {
    const market = getLiveMarket();
    if (!market) return 'no-live-market';
    const nextOpenAt = getNextScheduledStart(market, readDemoStore()?.markets || []);
    return [market.id, market.status, market.startAt, market.endAt, market.updatedAt, market.basePrice, market.imagePath, nextOpenAt].join('|');
  }

  let loadedMarketSignature = isEnabled ? getLiveMarketSignature() : '';

  function reloadIfLiveMarketChanged() {
    if (!isEnabled) return;
    const latestSignature = getLiveMarketSignature();
    if (latestSignature === loadedMarketSignature) return;
    loadedMarketSignature = latestSignature;
    window.location.reload();
  }

  function getNextScheduledStart(liveMarket, markets) {
    const liveEndAt = Date.parse(liveMarket.endAt || '');
    const next = markets
      .filter((market) => market.status === 'SCHEDULED' && Date.parse(market.startAt || '') > liveEndAt)
      .sort((left, right) => Date.parse(left.startAt) - Date.parse(right.startAt))[0];
    return next?.startAt || null;
  }

  // [설정 변환] 관리자 종목 레코드를 기존 거래소의 session/subject 구조로만 매핑합니다.
  // 주문·댓글·정산 데이터는 기존 회차 ID를 기준으로 각각의 로컬 서비스가 별도로 관리합니다.
  function getMarketConfigOverride(defaultConfig = {}) {
    const liveMarket = getLiveMarket();
    if (!liveMarket) return null;

    const startAt = Date.parse(liveMarket.startAt || '');
    const endAt = Date.parse(liveMarket.endAt || '');
    if (!Number.isFinite(startAt) || !Number.isFinite(endAt) || endAt <= startAt) return null;

    const markets = readDemoStore()?.markets || [];
    const defaultSubject = defaultConfig.subject || {};
    return {
      session: {
        id: String(liveMarket.id),
        startsAt: new Date(startAt).toISOString(),
        durationHours: (endAt - startAt) / (60 * 60 * 1000),
        nextOpenAt: getNextScheduledStart(liveMarket, markets),
      },
      subject: {
        // 관리자 종목 ID는 각 회차에서 유일하므로 로컬 댓글·투자 데이터의 종목 키로도 안전하게 사용할 수 있습니다.
        id: String(liveMarket.id),
        name: String(liveMarket.subjectName || defaultSubject.name || '오늘의 종목'),
        imagePath: String(liveMarket.imagePath || defaultSubject.imagePath || ''),
        description: String(liveMarket.description || liveMarket.shortIntroduction || defaultSubject.description || ''),
        initialPrice: Math.max(1, Math.round(Number(liveMarket.basePrice) || Number(defaultSubject.initialPrice) || 1000)),
      },
      localAdminMarket: {
        id: String(liveMarket.id),
        sequence: Number(liveMarket.sequence) || 0,
        commentsPublic: Boolean(liveMarket.commentsPublic),
      },
    };
  }

  // 다른 탭에서 관리자 페이지가 저장한 변경을 감지하면 거래소 탭을 새로고침해 최신 종목을 즉시 표시합니다.
  if (isEnabled) {
    window.addEventListener('storage', (event) => {
      if (event.key === ADMIN_STORE_KEY) reloadIfLiveMarketChanged();
    });
    // storage 이벤트를 지원하지 않거나 미리보기 탭에서 전달하지 않는 환경을 위한 보완입니다.
    window.setInterval?.(reloadIfLiveMarketChanged, 1500);
  }

  return Object.freeze({
    isEnabled: () => isEnabled,
    getLiveMarket,
    getLiveMarketSignature,
    getMarketConfigOverride,
  });
})();
