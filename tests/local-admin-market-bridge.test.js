// [로컬 운영 연동 테스트] 관리자 시연 LIVE 종목이 거래소 설정으로만 변환되고, API 환경에서는 무시되는지 확인합니다.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const bridgeCode = fs.readFileSync('scripts/local-admin-market-bridge.js', 'utf8');

function createWindow({ apiBaseUrl = '', store = null } = {}) {
  const localStorage = new Map();
  if (store) localStorage.set('jorong_admin_demo_v1', JSON.stringify(store));
  const listeners = {};
  const window = {
    JORONG_API_BASE_URL: apiBaseUrl,
    localStorage: { getItem: (key) => localStorage.get(key) || null },
    addEventListener: (name, handler) => { listeners[name] = handler; },
    location: { reload: () => { window.reloadCount += 1; } },
    dispatchEvent: (event) => { window.dispatchedEvents.push(event.type); },
    reloadCount: 0,
    dispatchedEvents: [],
    setInterval: () => 1,
  };
  window.__listeners = listeners;
  window.__storage = localStorage;
  return window;
}

function loadBridge(options) {
  const window = createWindow(options);
  class CustomEvent { constructor(type) { this.type = type; } }
  vm.runInNewContext(bridgeCode, { window, JSON, Date, Math, String, Number, Boolean, Object, CustomEvent });
  return { bridge: window.LocalAdminMarketBridge, window };
}

const defaultConfig = { subject: { name: '기본 종목', imagePath: './assets/default.png', description: '기본 설명', initialPrice: 1000 } };
const demoStore = {
  markets: [
    { id: 'market_001_hoon', status: 'LIVE', subjectName: '훈이', description: '종목 설명', imagePath: './assets/hoon.png', basePrice: 1000, sequence: 1, commentsPublic: true, startAt: '2026-08-15T04:00:00.000Z', endAt: '2026-08-15T10:00:00.000Z' },
  ],
};

test('로컬 LIVE 관리자 종목을 거래소 설정으로 변환한다', () => {
  const { bridge } = loadBridge({ store: demoStore });
  const override = bridge.getMarketConfigOverride(defaultConfig);
  assert.equal(bridge.isEnabled(), true);
  assert.equal(override.session.id, 'market_001_hoon');
  assert.equal(override.session.durationHours, 6);
  assert.equal(override.session.nextOpenAt, null);
  assert.equal(override.session.hasNextMarket, false);
  assert.equal(override.subject.name, '훈이');
  assert.equal(override.subject.initialPrice, 1000);
});

test('API 주소가 설정되면 로컬 관리자 데이터는 무시한다', () => {
  const { bridge } = loadBridge({ apiBaseUrl: 'https://api.example.com', store: demoStore });
  assert.equal(bridge.isEnabled(), false);
  assert.equal(bridge.getMarketConfigOverride(defaultConfig), null);
});

test('LIVE 종목이 없거나 시간이 잘못되면 기본 설정을 유지하도록 null을 반환한다', () => {
  const { bridge: noLive } = loadBridge({ store: { markets: [{ id: 'draft', status: 'DRAFT' }] } });
  assert.equal(noLive.getMarketConfigOverride(defaultConfig), null);

  const { bridge: invalidTime } = loadBridge({ store: { markets: [{ ...demoStore.markets[0], endAt: demoStore.markets[0].startAt }] } });
  assert.equal(invalidTime.getMarketConfigOverride(defaultConfig), null);
});

test('운영자가 수동 종료한 종목은 같은 회차 ID와 종료 상태로 정산 화면에 유지한다', () => {
  const closedStore = {
    markets: [{
      ...demoStore.markets[0],
      status: 'SETTLED',
      closedAt: '2026-08-15T05:30:00.000Z',
      settledAt: '2026-08-15T05:30:01.000Z',
      updatedAt: '2026-08-15T05:30:01.000Z',
    }],
  };
  const { bridge } = loadBridge({ store: closedStore });
  const override = bridge.getMarketConfigOverride(defaultConfig);
  assert.equal(bridge.getLiveMarket(), null);
  assert.equal(bridge.getExchangeMarket().id, 'market_001_hoon');
  assert.equal(override.session.id, 'market_001_hoon');
  assert.equal(override.session.status, 'SETTLED');
  assert.equal(override.subject.name, '훈이');
});

test('보관 처리된 이전 장도 정산 화면용 마지막 회차로 유지한다', () => {
  const archivedStore = {
    markets: [{
      ...demoStore.markets[0],
      status: 'ARCHIVED',
      closedAt: '2026-08-15T05:30:00.000Z',
      settledAt: '2026-08-15T05:30:01.000Z',
      updatedAt: '2026-08-15T05:30:02.000Z',
    }],
  };
  const { bridge } = loadBridge({ store: archivedStore });
  const override = bridge.getMarketConfigOverride(defaultConfig);
  assert.equal(bridge.getExchangeMarket().id, 'market_001_hoon');
  assert.equal(override.session.status, 'ARCHIVED');
});

test('종료·정산 이력 없는 보관 종목은 거래소나 정산 화면에 노출하지 않는다', () => {
  const deletedScheduledStore = {
    markets: [{
      ...demoStore.markets[0],
      status: 'ARCHIVED',
      // 예약 삭제는 종료·정산 이력이 없으므로 사용자 거래소의 회차가 되면 안 됩니다.
      closedAt: undefined,
      settledAt: undefined,
      updatedAt: '2026-08-15T05:30:02.000Z',
    }],
  };
  const { bridge } = loadBridge({ store: deletedScheduledStore });
  assert.equal(bridge.getExchangeMarket(), null);
  assert.equal(bridge.getMarketConfigOverride(defaultConfig), null);
});

test('관리자 저장소의 LIVE 종목이 바뀌면 거래소를 다시 불러온다', () => {
  const { window } = loadBridge({ store: demoStore });
  const nextStore = { markets: [{ ...demoStore.markets[0], id: 'market-new', subjectName: '새 종목', updatedAt: '2026-08-16T01:00:00.000Z' }] };
  window.__storage.set('jorong_admin_demo_v1', JSON.stringify(nextStore));
  window.__listeners.storage({ key: 'jorong_admin_demo_v1' });
  assert.equal(window.reloadCount, 1);
  assert.deepEqual(window.dispatchedEvents, ['jorong:admin-market-updated']);
});

test('다음 예약 종목의 시작 시각이 추가되거나 바뀌면 다음 장 타이머를 갱신한다', () => {
  const { window } = loadBridge({ store: demoStore });
  const scheduledStore = {
    markets: [
      ...demoStore.markets,
      { id: 'market-next', status: 'SCHEDULED', subjectName: '다음 종목', startAt: '2026-08-16T13:00:00.000Z', endAt: '2026-08-16T19:00:00.000Z' },
    ],
  };
  window.__storage.set('jorong_admin_demo_v1', JSON.stringify(scheduledStore));
  window.__listeners.storage({ key: 'jorong_admin_demo_v1' });
  assert.equal(window.reloadCount, 1);
});

test('수동 조기 종료 뒤에는 실제 종료 시각 다음의 예약 종목을 정산 타이머에 사용한다', () => {
  const terminalMarket = {
    ...demoStore.markets[0],
    status: 'SETTLED',
    // 원래 종료 시각은 10:00이지만 운영자가 05:30에 조기 종료한 상황입니다.
    closedAt: '2026-08-15T05:30:00.000Z',
    settledAt: '2026-08-15T05:30:01.000Z',
  };
  const nextStartAt = '2026-08-15T06:00:00.000Z';
  const { bridge } = loadBridge({
    store: {
      markets: [
        terminalMarket,
        { id: 'market-next-after-close', status: 'SCHEDULED', subjectName: '다음 종목', startAt: nextStartAt, endAt: '2026-08-15T12:00:00.000Z' },
      ],
    },
  });

  assert.equal(bridge.getMarketConfigOverride(defaultConfig).session.nextOpenAt, nextStartAt);
  assert.equal(bridge.getMarketConfigOverride(defaultConfig).session.hasNextMarket, true);
});

test('종료 시각 정보가 어긋나도 미래 예약 종목은 정산 타이머에 남긴다', () => {
  const terminalMarket = {
    ...demoStore.markets[0],
    status: 'SETTLED',
    // 로컬 시연에서 잘못 기록된 늦은 정산 시각을 재현합니다.
    settledAt: '2099-01-01T00:00:00.000Z',
  };
  const nextStartAt = '2098-12-31T23:00:00.000Z';
  const { bridge } = loadBridge({
    store: {
      markets: [
        terminalMarket,
        { id: 'market-scheduled', status: 'SCHEDULED', subjectName: '예약 종목', startAt: nextStartAt, endAt: '2099-01-01T05:00:00.000Z' },
      ],
    },
  });
  assert.equal(bridge.getMarketConfigOverride(defaultConfig).session.nextOpenAt, nextStartAt);
});
