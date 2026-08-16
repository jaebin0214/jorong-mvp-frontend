// [운영 설정 테스트] 관리자에서 LIVE 종목을 게시하기 전에는 거래소가 더미 종목을 만들지 않는지 검증합니다.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'market-config.js'), 'utf8');

function loadConfig({ serverConfig = {}, localConfig = null } = {}) {
  const window = {
    JORONG_MARKET_CONFIG: serverConfig,
    LocalAdminMarketBridge: { getMarketConfigOverride: () => localConfig },
  };
  vm.runInNewContext(source, { window, Object, String, Number, Boolean, Math, Date });
  return window.MarketConfig;
}

test('관리자 LIVE 종목이 없으면 거래소는 더미 종목 없이 대기 상태가 된다', () => {
  const config = loadConfig().get();
  assert.equal(config.marketAvailable, false);
  assert.equal(config.session.id, 'no-active-market');
  assert.equal(config.subject.name, '');
  assert.equal(config.session.status, 'SCHEDULED');
});

test('관리자에서 게시한 LIVE 종목은 거래소 운영 설정으로 사용한다', () => {
  const config = loadConfig({
    localConfig: {
      session: { id: 'market-first', startsAt: '2026-08-16T13:00:00.000Z', durationHours: 6, status: 'OPEN' },
      subject: { id: 'target-first', name: '첫 종목', imagePath: './assets/first.png', description: '첫 게시 종목', initialPrice: 1250 },
    },
  }).get();
  assert.equal(config.marketAvailable, true);
  assert.equal(config.session.id, 'market-first');
  assert.equal(config.subject.name, '첫 종목');
  assert.equal(config.subject.initialPrice, 1250);
});

test('종료·정산 완료 장도 대기 상태가 아닌 유효한 거래소 회차로 유지한다', () => {
  const config = loadConfig({
    localConfig: {
      session: { id: 'market-settled', startsAt: '2026-08-16T13:00:00.000Z', durationHours: 6, status: 'SETTLED', nextOpenAt: '2026-08-17T13:00:00.000Z' },
      subject: { id: 'target-settled', name: '종료 종목', imagePath: './assets/settled.png', description: '정산 대상', initialPrice: 1000 },
    },
  }).get();
  assert.equal(config.marketAvailable, true);
  assert.equal(config.session.status, 'SETTLED');
  assert.equal(config.session.hasNextMarket, true);
});

test('다음 개장 시각이 제공되면 명시값이 없어도 다음 거래 예약으로 인식한다', () => {
  const config = loadConfig({
    serverConfig: {
      session: { id: 'market-server', startsAt: '2026-08-16T13:00:00.000Z', durationHours: 6, nextOpenAt: '2026-08-17T13:00:00.000Z', status: 'OPEN' },
      subject: { id: 'server-target', name: '서버 종목', initialPrice: 1000 },
    },
  }).get();
  assert.equal(config.session.hasNextMarket, true);
});
