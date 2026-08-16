// [시장 런타임 API 테스트] 서버의 현재·종료 시장 응답이 기존 MarketConfig 형식으로 안전하게 바뀌는지 검증합니다.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'market-runtime-bootstrap.js'), 'utf8');

function loadBootstrap() {
  const storage = new Map();
  const window = {
    JORONG_API_BASE_URL: 'https://api.example.test',
    localStorage: { getItem: (key) => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) },
    location: { reload() {} },
    setInterval() { return 1; },
  };
  // 초기 자동 조회는 이 테스트의 정규화 검증과 분리합니다.
  const fetch = () => new Promise(() => {});
  vm.runInNewContext(source, { window, fetch, JSON, Date, Number, String, Boolean, Object, Math });
  return window.MarketRuntimeBootstrap;
}

test('OPEN 시장 응답은 종목·기준가·다음 예약을 MarketConfig 구조로 정규화한다', () => {
  const bootstrap = loadBootstrap();
  const config = bootstrap.normalizeRuntimeConfig({
    displayMarket: {
      id: 'market-001', status: 'OPEN', openAt: '2026-08-17T13:00:00+09:00', closeAt: '2026-08-17T19:00:00+09:00',
      subject: { id: 'hoon', name: '훈이', imageUrl: 'https://cdn.example.test/hoon.png', description: '설명', initialPrice: 1250 },
    },
    nextMarket: { id: 'market-002', openAt: '2026-08-18T13:00:00+09:00' },
  });
  assert.equal(config.marketAvailable, true);
  assert.equal(config.session.id, 'market-001');
  assert.equal(config.session.status, 'OPEN');
  assert.equal(config.session.hasNextMarket, true);
  assert.equal(config.subject.name, '훈이');
  assert.equal(config.subject.initialPrice, 1250);
});

test('종료 시장도 displayMarket으로 받으면 정산 화면용 회차를 유지한다', () => {
  const bootstrap = loadBootstrap();
  const config = bootstrap.normalizeRuntimeConfig({
    lastMarket: {
      id: 'market-closed', status: 'SETTLED', openAt: '2026-08-17T13:00:00+09:00', closeAt: '2026-08-17T19:00:00+09:00',
      subject: { id: 'hoon', name: '훈이', initialPrice: 1000 },
    },
  });
  assert.equal(config.marketAvailable, true);
  assert.equal(config.session.id, 'market-closed');
  assert.equal(config.session.status, 'SETTLED');
  assert.equal(config.subject.initialPrice, 1000);
});
