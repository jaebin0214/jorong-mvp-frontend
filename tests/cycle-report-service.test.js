// [사이클 리포트 테스트] 로컬 시연의 정산 결과가 사용자별로 보관되고 같은 시장은 중복되지 않는지 검증합니다.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');

const serviceCode = fs.readFileSync('scripts/cycle-report-service.js', 'utf8');

function createService() {
  const storage = new Map();
  const listeners = {};
  const window = {
    JORONG_API_BASE_URL: '',
    AuthService: { getCurrentAccount: () => ({ id: 'user-01', nickname: '테스트유저' }), getRequestHeaders: () => ({}) },
    MarketConfig: { get: () => ({ subject: { id: 'hoon', name: '훈이', imagePath: './assets/hoon.png' } }) },
    localStorage: { getItem: (key) => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) },
    addEventListener: (name, handler) => { listeners[name] = handler; },
    dispatchEvent: () => true,
  };
  vm.runInNewContext(serviceCode, { window, Date, JSON, Math, String, Number, Array, Object, Promise, CustomEvent: class CustomEvent { constructor(name, init) { this.type = name; this.detail = init?.detail; } } });
  return { service: window.CycleReportService, storage };
}

function snapshot({ marketId = 'market-001', settledAt = '2026-08-15T10:00:00.000Z', settlementAmount = '3226' } = {}) {
  return {
    market: { id: marketId, status: 'SETTLED', closePrice: '860', closeAt: settledAt },
    position: { id: `position-${marketId}`, side: 'MOCK', totalInvestment: '3000', quantity: '3.225806451613', averagePrice: '930', status: 'SETTLED' },
    settlement: { id: `settlement-${marketId}`, closePrice: '860', realizedPnl: '225.80645161', pnlRate: '7.52688172', settlementAmount, balanceAfterSettlement: '100226', settledAt },
    wallet: { points: 100226 },
    marketSummary: { supportRatio: 38, mockRatio: 62, totalVolume: '1248000', participants: 312 },
  };
}

test('종료된 시장의 개인 정산 결과를 사용자별 로컬 리포트에 보관한다', async () => {
  const { service, storage } = createService();
  service.archiveSnapshot(snapshot());
  const reports = await service.loadReports();
  assert.equal(reports.length, 1);
  assert.equal(reports[0].market.id, 'market-001');
  assert.equal(reports[0].subject.name, '훈이');
  assert.equal(reports[0].settlement.settlementAmount, '3226');
  assert.ok([...storage.keys()].some((key) => key.includes('jorong:cycle-report-history:v1:user-01')));
});

test('같은 시장의 리포트는 중복 생성하지 않고 최신 정산 정보로 갱신한다', async () => {
  const { service } = createService();
  service.archiveSnapshot(snapshot({ settlementAmount: '3226' }));
  service.archiveSnapshot(snapshot({ settlementAmount: '3250' }));
  service.archiveSnapshot(snapshot({ marketId: 'market-000', settledAt: '2026-08-14T10:00:00.000Z' }));
  const reports = await service.loadReports();
  assert.equal(reports.length, 2);
  assert.equal(reports[0].market.id, 'market-001');
  assert.equal(reports[0].settlement.settlementAmount, '3250');
});
