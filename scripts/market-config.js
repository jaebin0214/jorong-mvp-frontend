// [운영 설정] 운영자는 이 파일만 수정해 다음 거래 회차의 종목·이미지·초기 가격·거래 시간을 교체합니다.
(() => {
  const DEFAULT_MARKET_CONFIG = {
    // 회차 ID는 종목 또는 거래 시간을 변경할 때마다 반드시 새 값으로 바꿉니다.
    session: {
      id: 'test1',
      // null이면 첫 접속 시점부터 시간이 흐릅니다. 실제 운영에서는 ISO 형식 시작 시각을 권장합니다.
      startsAt: null,
      durationHours: 3,
    },
    subject: {
      id: 'hoon',
      name: '훈이',
      imagePath: './assets/hoon.png',
      // [종목 소개] 거래소 첫 진입 시 표시되는 안내 창의 설명입니다. 다음 종목으로 교체할 때 이름·이미지와 함께 수정합니다.
      description: '훈이는 『짱구는 못말려』에 등장하는 짱구의 친구 중 한 명이다. 겁이 많고 소심한 면모를 보이지만, 기본적으로 착하고 친구들을 생각하는 마음을 가지고 있다. 위험하거나 당황스러운 상황에서는 쉽게 겁을 먹지만 친구들과 함께할 때는 용기를 내기도 한다.',
      initialPrice: 1000,
    },
  };

  // 배포 환경에서는 index.html보다 먼저 window.JORONG_MARKET_CONFIG를 주입해 같은 구조로 값을 덮어쓸 수 있습니다.
  const runtimeConfig = window.JORONG_MARKET_CONFIG || {};
  const config = {
    session: { ...DEFAULT_MARKET_CONFIG.session, ...(runtimeConfig.session || {}) },
    subject: { ...DEFAULT_MARKET_CONFIG.subject, ...(runtimeConfig.subject || {}) },
  };

  // 잘못된 운영 값으로 투자·타이머가 멈추지 않도록 최소한의 형식 검증과 보정을 적용합니다.
  config.session.id = String(config.session.id || DEFAULT_MARKET_CONFIG.session.id);
  config.session.durationHours = Math.max(0.01, Number(config.session.durationHours) || DEFAULT_MARKET_CONFIG.session.durationHours);
  config.session.startsAt = config.session.startsAt && !Number.isNaN(Date.parse(config.session.startsAt))
    ? config.session.startsAt
    : null;
  config.subject.id = String(config.subject.id || DEFAULT_MARKET_CONFIG.subject.id);
  config.subject.name = String(config.subject.name || DEFAULT_MARKET_CONFIG.subject.name);
  config.subject.imagePath = String(config.subject.imagePath || DEFAULT_MARKET_CONFIG.subject.imagePath);
  config.subject.description = String(config.subject.description || DEFAULT_MARKET_CONFIG.subject.description);
  config.subject.initialPrice = Math.max(1, Math.round(Number(config.subject.initialPrice) || DEFAULT_MARKET_CONFIG.subject.initialPrice));

  window.MarketConfig = Object.freeze({
    // 다른 기능은 이 메서드로만 설정을 읽어, 운영 값을 한 곳에서 일관되게 사용합니다.
    get: () => config,
  });
})();
