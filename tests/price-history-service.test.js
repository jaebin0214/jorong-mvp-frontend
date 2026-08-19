// [가격 이력 서비스 테스트] 로컬 시연에서 동일 시장의 여러 계정 주문을 모두 캔들 이력에 반영하는지 검증합니다.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync('scripts/price-history-service.js', 'utf8');

test('로컬 캔들은 현재 사용자뿐 아니라 같은 시장의 모든 투자 주문을 시간순으로 반영한다', async () => {
  const startAt = Date.parse('2026-08-16T00:00:00.000Z');
  const endAt = startAt + (6 * 60 * 60 * 1000);
  const orders = [
    { id: 'order-user-a', marketId: 'market-all-users', createdAt: new Date(startAt + 60_000).toISOString(), investmentAmount: '3000', resultingPrice: '1030', side: 'SUPPORT' },
    { id: 'order-user-b', marketId: 'market-all-users', createdAt: new Date(startAt + 120_000).toISOString(), investmentAmount: '2000', resultingPrice: '1010', side: 'MOCK' },
  ];
  const window = {
    JORONG_API_BASE_URL: '',
    MarketConfig: { get: () => ({ session: { id: 'market-all-users', startsAt: new Date(startAt).toISOString(), durationHours: 6 }, subject: { id: 'subject-01', initialPrice: 1000 } }) },
    MarketCountdown: { getSessionId: () => 'market-all-users', getEndAt: () => endAt },
    InvestmentService: { getMarketOrders: () => orders, getSnapshot: () => ({ orders: [] }) },
    AuthService: { getRequestHeaders: () => ({}) },
  };
  vm.runInNewContext(source, { window, Date, JSON, Math, String, Number, Object, Array, URLSearchParams });
  const candles = await window.PriceHistoryService.loadCandles();
  assert.equal(candles.length, 3);
  assert.equal(candles[0].close, 1000);
  assert.ok(candles[1].close > candles[0].close);
  assert.ok(candles[2].close < candles[1].close);
  assert.equal(candles[1].volume, 3000);
  assert.equal(candles[2].volume, 2000);
});

test('Supabase 연결 시 투자 직후에도 임시 로컬 캔들이 아닌 서버 집계 캔들을 사용한다', async () => {
  const startAt = Date.parse('2026-08-16T00:00:00.000Z');
  const endAt = startAt + (6 * 60 * 60 * 1000);
  let rpcCalls = 0;
  const window = {
    JorongSupabase: {
      rpc: async (name, args) => {
        rpcCalls += 1;
        assert.equal(name, 'get_market_candles');
        // VM 내부에서 생성된 객체는 프로토타입이 달라 deepEqual 대신 요청 필드를 개별 검증합니다.
        assert.equal(args.p_market_id, 'market-server');
        assert.equal(args.p_interval_seconds, 30);
        return {
          data: {
            initialPrice: 925,
            candles: [{
              started_at: new Date(startAt + 60_000).toISOString(),
              ended_at: new Date(startAt + 120_000).toISOString(),
              open: 1000,
              high: 1060,
              low: 990,
              close: 1040,
              volume: 5000,
            }],
          },
          error: null,
        };
      },
    },
    MarketConfig: { get: () => ({ session: { id: 'market-server', startsAt: new Date(startAt).toISOString(), durationHours: 6 }, subject: { id: 'subject-01', initialPrice: 1000 } }) },
    MarketCountdown: { getSessionId: () => 'market-server', getEndAt: () => endAt },
  };
  vm.runInNewContext(source, { window, Date, JSON, Math, String, Number, Object, Array, URLSearchParams });

  const candles = await window.PriceHistoryService.recordInvestment({
    order: { id: 'order-1', resultingPrice: '9999', investmentAmount: '3000', side: 'SUPPORT' },
  });

  assert.equal(rpcCalls, 1);
  assert.equal(candles.length, 1);
  assert.equal(candles[0].close, 1040);
  assert.equal(candles[0].volume, 5000);
  assert.equal(window.PriceHistoryService.getInitialPrice(), 925);
  assert.equal(window.PriceHistoryService.getCandleIntervalSeconds(), 30);
});

test('Supabase가 과거 revision 또는 더 작은 누적 거래량을 반환하면 마지막 확정 캔들을 유지한다', async () => {
  const startAt = Date.parse('2026-08-16T00:00:00.000Z');
  const endAt = startAt + (6 * 60 * 60 * 1000);
  const responses = [
    {
      marketSessionId: 'market-stable-history',
      revision: 8,
      candles: [
        { startedAt: new Date(startAt).toISOString(), endedAt: new Date(startAt + 30_000).toISOString(), open: 1000, high: 1040, low: 1000, close: 1040, volume: 3000 },
        { startedAt: new Date(startAt + 30_000).toISOString(), endedAt: new Date(startAt + 60_000).toISOString(), open: 1040, high: 1060, low: 1030, close: 1050, volume: 2000 },
      ],
    },
    {
      // 복제 지연으로 첫 번째 주문만 보이는 오래된 응답을 흉내 냅니다.
      marketSessionId: 'market-stable-history',
      revision: 7,
      candles: [
        { startedAt: new Date(startAt).toISOString(), endedAt: new Date(startAt + 30_000).toISOString(), open: 1000, high: 1040, low: 1000, close: 1040, volume: 3000 },
      ],
    },
  ];
  const window = {
    JorongSupabase: {
      rpc: async () => ({ data: responses.shift(), error: null }),
    },
    MarketConfig: { get: () => ({ session: { id: 'market-stable-history', startsAt: new Date(startAt).toISOString(), durationHours: 6 }, subject: { id: 'subject-01', initialPrice: 1000 } }) },
    MarketCountdown: { getSessionId: () => 'market-stable-history', getEndAt: () => endAt },
  };
  vm.runInNewContext(source, { window, Date, JSON, Math, String, Number, Object, Array, URLSearchParams });

  const accepted = await window.PriceHistoryService.loadCandles();
  const stale = await window.PriceHistoryService.loadCandles();

  assert.equal(accepted.length, 2);
  assert.equal(stale.length, 2);
  assert.equal(stale.at(-1).close, 1050);
  assert.equal(window.PriceHistoryService.getLatestServerHistoryMeta().revision, 8);
});
