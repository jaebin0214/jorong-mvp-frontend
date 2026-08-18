// [시장 런타임 부트스트랩] Supabase 연결 환경에서 현재 또는 가장 최근 종료 시장의 종목·시간 설정을
// 먼저 캐시해 정적 HTML도 서버 데이터로 초기화합니다. 미연결이면 로컬 관리자 브리지가 그대로 동작합니다.
(() => {
  const supabaseClient = window.JorongSupabase;
  // [이전 REST 호환] Supabase 전환 중에도 기존 API 설정으로 실행·테스트할 수 있게 둡니다.
  const legacyApiBaseUrl = (window.JORONG_API_BASE_URL || '').replace(/\/$/, '');
  const legacyRuntimeUrl = window.JORONG_MARKET_RUNTIME_CONFIG_URL || `${legacyApiBaseUrl}/markets/current`;
  const CACHE_KEY = 'jorong:market-runtime-config:v1';
  const hasExplicitConfig = Boolean(Object.keys(window.JORONG_MARKET_CONFIG || {}).length);
  const hasRuntimeSource = Boolean(supabaseClient || legacyApiBaseUrl);

  function readCache() {
    try {
      const cached = JSON.parse(window.localStorage.getItem(CACHE_KEY) || 'null');
      return cached?.config && typeof cached.config === 'object' ? cached.config : null;
    } catch (_) {
      return null;
    }
  }

  function writeCache(config) {
    try { window.localStorage.setItem(CACHE_KEY, JSON.stringify({ config, savedAt: new Date().toISOString() })); } catch (_) { /* 저장소가 막힌 환경에서는 이번 접속만 사용합니다. */ }
  }

  // get_market_runtime() RPC의 반환 형태(displayMarket/nextMarket)를 화면용 설정 구조로 통일합니다.
  function normalizeRuntimeConfig(payload = {}) {
    // RPC는 LIVE 시장, 없으면 가장 최근 CLOSED/SETTLED 시장을 displayMarket으로 반환합니다.
    const market = payload.displayMarket || payload.market || payload.currentMarket || payload.lastMarket || payload.session || {};
    const subject = market.subject || payload.subject || {};
    const startAt = market.openAt || market.startsAt || market.startAt || payload.openAt || payload.startsAt || null;
    const closeAt = market.closeAt || market.endsAt || market.endAt || payload.closeAt || payload.endsAt || null;
    const startTime = Date.parse(startAt || '');
    const closeTime = Date.parse(closeAt || '');
    const durationHours = Number(market.durationHours ?? payload.durationHours);
    const computedDuration = Number.isFinite(startTime) && Number.isFinite(closeTime) && closeTime > startTime
      ? (closeTime - startTime) / (60 * 60 * 1000)
      : durationHours;
    const marketId = market.id || market.marketId || payload.marketId || '';
    const status = String(market.status || payload.status || (marketId ? 'OPEN' : 'SCHEDULED')).toUpperCase();
    const nextOpenAt = market.nextOpenAt || payload.nextOpenAt || payload.nextMarket?.openAt || payload.nextMarket?.startAt || null;

    if (!marketId || !Number.isFinite(startTime) || !Number.isFinite(closeTime) || closeTime <= startTime) {
      return {
        marketAvailable: false,
        session: { id: 'no-active-market', startsAt: null, durationHours: 6, nextOpenAt: null, hasNextMarket: false, status: 'SCHEDULED' },
        subject: { id: '', name: '', imagePath: '', description: '', initialPrice: 1000 },
      };
    }

    return {
      marketAvailable: payload.marketAvailable !== false,
      session: {
        id: String(marketId),
        startsAt: new Date(startTime).toISOString(),
        durationHours: Math.max(0.01, Number(computedDuration) || 6),
        nextOpenAt: Number.isFinite(Date.parse(nextOpenAt || '')) ? new Date(nextOpenAt).toISOString() : null,
        hasNextMarket: Boolean(nextOpenAt && !Number.isNaN(Date.parse(nextOpenAt))),
        status,
      },
      subject: {
        id: String(subject.id || market.targetId || market.subjectId || ''),
        name: String(subject.name || subject.subjectName || market.subjectName || market.targetName || '오늘의 종목'),
        imagePath: String(subject.imageUrl || subject.imagePath || market.targetImageUrl || market.imageUrl || market.imagePath || ''),
        description: String(subject.description || market.description || market.shortIntroduction || ''),
        initialPrice: Math.max(1, Math.round(Number(subject.initialPrice ?? market.initialPrice ?? market.basePrice) || 1000)),
      },
    };
  }

  function signature(config) {
    return JSON.stringify(config);
  }

  // 캐시가 있으면 동기적으로 주입해 첫 화면의 빈 상태를 피하고, 아래 요청으로 서버 최신값을 확인합니다.
  const cachedConfig = readCache();
  if (cachedConfig) window.JORONG_MARKET_CONFIG = cachedConfig;

  async function syncRuntimeConfig() {
    try {
      let payload;
      if (supabaseClient) {
        const { data, error } = await supabaseClient.rpc('get_market_runtime');
        if (error) throw error;
        payload = data || {};
      } else if (legacyApiBaseUrl) {
        const response = await fetch(legacyRuntimeUrl, { credentials: 'include', headers: { Accept: 'application/json' }, cache: 'no-store' });
        if (!response.ok) throw new Error('시장 런타임 정보를 불러오지 못했습니다.');
        payload = await response.json();
      } else {
        return;
      }
      const config = normalizeRuntimeConfig(payload);
      const current = window.JORONG_MARKET_CONFIG || {};
      if (signature(config) === signature(current)) return;
      writeCache(config);
      window.JORONG_MARKET_CONFIG = config;
      // 기존 모듈은 시작 시 한 번만 시장 설정을 읽으므로, 시장 회차가 바뀐 경우 안전하게 다시 초기화합니다.
      window.location.reload();
    } catch (_) {
      // 네트워크/RPC 오류에서는 마지막 캐시를 유지합니다. 다음 동기화에서 다시 시도합니다.
    }
  }

  // [테스트·호환 공개] 실제 런타임 소스가 없더라도 응답 정규화 함수는 독립적으로 검증할 수 있습니다.
  window.MarketRuntimeBootstrap = Object.freeze({ normalizeRuntimeConfig, syncRuntimeConfig });
  if (!hasRuntimeSource || hasExplicitConfig) return;

  syncRuntimeConfig();
  // 서버 스케줄러가 새 장을 열거나 예약을 변경한 경우에도 현재 화면 설정을 갱신합니다.
  window.setInterval(syncRuntimeConfig, 30_000);
})();
