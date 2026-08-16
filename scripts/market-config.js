// [운영 설정] 실제 종목·거래 시간은 관리자 페이지 또는 서버가 제공하며, 이 파일은 활성 시장이 없을 때의 안전한 대기 상태만 제공합니다.
(() => {
  const DEFAULT_MARKET_CONFIG = {
    // [빈 거래소] 운영자가 첫 종목을 LIVE로 전환하기 전에는 어떠한 더미 종목도 표시하지 않습니다.
    marketAvailable: false,
    session: {
      id: 'no-active-market',
      startsAt: null,
      durationHours: 6,
      nextOpenAt: null,
      hasNextMarket: false,
      status: 'SCHEDULED',
    },
    subject: {
      id: '',
      name: '',
      imagePath: '',
      description: '',
      // 투자·차트 모듈의 안전한 초기화용 값이며, 활성 종목이 없을 때 화면에는 표시하지 않습니다.
      initialPrice: 1000,
    },
  };

  // 배포 환경에서는 index.html보다 먼저 window.JORONG_MARKET_CONFIG를 주입해 같은 구조로 값을 덮어쓸 수 있습니다.
  // API가 없을 때만 로컬 관리자 브리지가 LIVE 종목을 같은 구조로 제공합니다.
  const serverRuntimeConfig = window.JORONG_MARKET_CONFIG || {};
  const localAdminRuntimeConfig = window.LocalAdminMarketBridge?.getMarketConfigOverride?.(DEFAULT_MARKET_CONFIG) || null;
  const hasServerRuntimeConfig = Boolean(Object.keys(serverRuntimeConfig).length);
  const runtimeConfig = hasServerRuntimeConfig ? serverRuntimeConfig : (localAdminRuntimeConfig || {});
  const configSource = hasServerRuntimeConfig ? 'SERVER_RUNTIME' : (localAdminRuntimeConfig ? 'LOCAL_ADMIN_DEMO' : 'EMPTY_LOCAL');
  const config = {
    marketAvailable: hasServerRuntimeConfig || Boolean(localAdminRuntimeConfig),
    session: { ...DEFAULT_MARKET_CONFIG.session, ...(runtimeConfig.session || {}) },
    subject: { ...DEFAULT_MARKET_CONFIG.subject, ...(runtimeConfig.subject || {}) },
  };

  // 잘못된 운영 값으로 투자·타이머가 멈추지 않도록 최소한의 형식 검증과 보정을 적용합니다.
  config.session.id = String(config.session.id || DEFAULT_MARKET_CONFIG.session.id);
  config.session.durationHours = Math.max(0.01, Number(config.session.durationHours) || DEFAULT_MARKET_CONFIG.session.durationHours);
  config.session.startsAt = config.session.startsAt && !Number.isNaN(Date.parse(config.session.startsAt))
    ? config.session.startsAt
    : null;
  config.session.nextOpenAt = config.session.nextOpenAt && !Number.isNaN(Date.parse(config.session.nextOpenAt))
    ? config.session.nextOpenAt
    : null;
  // 로컬 운영자 브리지는 예약 종목이 있는 경우에만 true를 명시합니다.
  // 서버 연결 뒤에는 유효한 nextOpenAt을 기준으로 같은 값을 계산할 수 있습니다.
  const runtimeHasNextMarket = runtimeConfig.session?.hasNextMarket;
  config.session.hasNextMarket = typeof runtimeHasNextMarket === 'boolean'
    ? runtimeHasNextMarket
    : Boolean(config.session.nextOpenAt);
  config.session.status = String(config.session.status || 'OPEN').toUpperCase();
  // 서버가 시장 미운영 상태를 명시한 경우도 존중합니다. 실제 활성 시장 판단은 서버가 최종 책임집니다.
  if (typeof runtimeConfig.marketAvailable === 'boolean') config.marketAvailable = runtimeConfig.marketAvailable;
  config.marketAvailable = Boolean(config.marketAvailable);
  if (!config.marketAvailable) config.session.status = 'SCHEDULED';
  config.subject.id = String(config.subject.id || DEFAULT_MARKET_CONFIG.subject.id);
  config.subject.name = String(config.subject.name || DEFAULT_MARKET_CONFIG.subject.name);
  config.subject.imagePath = String(config.subject.imagePath || DEFAULT_MARKET_CONFIG.subject.imagePath);
  config.subject.description = String(config.subject.description || DEFAULT_MARKET_CONFIG.subject.description);
  config.subject.initialPrice = Math.max(1, Math.round(Number(config.subject.initialPrice) || DEFAULT_MARKET_CONFIG.subject.initialPrice));

  window.MarketConfig = Object.freeze({
    // 다른 기능은 이 메서드로만 설정을 읽어, 운영 값을 한 곳에서 일관되게 사용합니다.
    get: () => config,
    // [데이터 출처] 화면에 적용 중인 설정이 기본 파일·로컬 관리자 시연·서버 주입값 중 무엇인지 확인합니다.
    getSource: () => configSource,
    getLocalAdminMarket: () => localAdminRuntimeConfig?.localAdminMarket || null,
  });
})();
