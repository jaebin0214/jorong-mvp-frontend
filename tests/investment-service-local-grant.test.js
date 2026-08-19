// [시장 참여 크레딧 테스트] 로컬 시연에서도 신규 가입 보상 없이 시장별 지급을 한 번만 더하는지 검증합니다.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function createInvestmentService({ accountPoints = 0, marketStatus = 'OPEN' } = {}) {
  const storage = new Map();
  const account = { id: 'local-account-001', nickname: '로컬사용자', points: accountPoints };
  const window = {
    localStorage: {
      getItem: (key) => storage.get(key) || null,
      setItem: (key, value) => storage.set(key, value),
    },
    MarketConfig: {
      get: () => ({
        marketAvailable: true,
        session: { id: 'market-credit-001', status: marketStatus, durationHours: 6, startsAt: new Date().toISOString() },
        subject: { id: 'subject-001', initialPrice: 1000 },
      }),
    },
    MarketCountdown: {
      getSessionId: () => 'market-credit-001',
      getEndAt: () => Date.now() + 60 * 60 * 1000,
      isEnded: () => false,
      requiresServerClock: () => false,
    },
    AuthService: {
      getCurrentAccount: () => account,
      updateLocalWalletPoints: (points) => { account.points = Number(points); },
    },
    addEventListener: () => {},
    dispatchEvent: () => {},
  };
  const sandbox = { window, JSON, Date, Math, String, Number, Object, BigInt, Set, CustomEvent: function CustomEvent() {} };
  const mathSource = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'financial-math.js'), 'utf8');
  const serviceSource = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'investment-service.js'), 'utf8');
  vm.runInNewContext(mathSource, sandbox, { filename: 'financial-math.js' });
  vm.runInNewContext(serviceSource, sandbox, { filename: 'investment-service.js' });
  return { service: window.InvestmentService, account, storage };
}

test('OPEN 시장의 로그인 사용자는 기존 잔액에 100,000 크레딧을 한 번만 더 받는다', async () => {
  const { service, account, storage } = createInvestmentService({ accountPoints: 3500 });

  const first = await service.loadPortfolio();
  const second = await service.loadPortfolio();

  assert.equal(first.wallet.points, 103500);
  assert.equal(second.wallet.points, 103500);
  assert.equal(account.points, 103500);
  const stored = JSON.parse(storage.get('jorong:investment-ledger:market-credit-001'));
  assert.equal(stored.accounts['local-account-001'].marketOpeningGrant.amount, 100000);
});

test('종료된 시장에는 시장 참여 크레딧을 지급하지 않는다', async () => {
  const { service, account } = createInvestmentService({ accountPoints: 3500, marketStatus: 'SETTLED' });

  const snapshot = await service.loadPortfolio();

  assert.equal(snapshot.wallet.points, 3500);
  assert.equal(account.points, 3500);
});
