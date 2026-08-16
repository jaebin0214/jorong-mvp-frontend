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
    reloadCount: 0,
    setInterval: () => 1,
  };
  window.__listeners = listeners;
  window.__storage = localStorage;
  return window;
}

function loadBridge(options) {
  const window = createWindow(options);
  vm.runInNewContext(bridgeCode, { window, JSON, Date, Math, String, Number, Boolean, Object });
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

test('관리자 저장소의 LIVE 종목이 바뀌면 거래소를 다시 불러온다', () => {
  const { window } = loadBridge({ store: demoStore });
  const nextStore = { markets: [{ ...demoStore.markets[0], id: 'market-new', subjectName: '새 종목', updatedAt: '2026-08-16T01:00:00.000Z' }] };
  window.__storage.set('jorong_admin_demo_v1', JSON.stringify(nextStore));
  window.__listeners.storage({ key: 'jorong_admin_demo_v1' });
  assert.equal(window.reloadCount, 1);
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
