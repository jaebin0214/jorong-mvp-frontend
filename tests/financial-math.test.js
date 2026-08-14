// [고정밀 계산 테스트] 문서의 조롱 예시와 가중평균·손실 제한을 Node 기본 테스트로 검증합니다.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'financial-math.js'), 'utf8');
const sandbox = { window: {} };
vm.runInNewContext(source, sandbox, { filename: 'financial-math.js' });
const math = sandbox.window.FinancialMath;

test('조롱 3,000 KRW / 평균 단가 930 / 현재가 900 예시', () => {
  const position = math.calculatePositionAfterOrder({ side: 'MOCK', investmentAmount: 3000, executionPrice: 930 });
  const metrics = math.calculateMetrics({ position, currentPrice: 900 });

  assert.equal(math.formatQuantity(position.quantity), '3.2258주');
  assert.equal(math.formatKrw(metrics.unrealizedPnl), '+97 KRW');
  assert.equal(math.formatRate(metrics.pnlRate), '+3.23%');
  assert.equal(math.formatKrwUnsigned(metrics.estimatedSettlementAmount), '3,097 KRW');
});

test('조롱 3,000 KRW / 평균 단가 930 / 마감가 860 정산 예시', () => {
  const position = math.calculatePositionAfterOrder({ side: 'MOCK', investmentAmount: 3000, executionPrice: 930 });
  const settlement = math.calculateSettlement({ position, closePrice: 860, balanceBeforeSettlement: 97000 });

  assert.equal(math.formatKrw(settlement.realizedPnl), '+226 KRW');
  assert.equal(math.formatRate(settlement.pnlRate), '+7.53%');
  assert.equal(math.formatKrwUnsigned(settlement.settlementAmount), '3,226 KRW');
  assert.equal(settlement.balanceAfterSettlement, '100226');
});

test('동일 의견 추가 투자 시 가중평균 단가를 사용한다', () => {
  const first = math.calculatePositionAfterOrder({ side: 'SUPPORT', investmentAmount: 3000, executionPrice: 1000 });
  const second = math.calculatePositionAfterOrder({ position: first, side: 'SUPPORT', investmentAmount: 2000, executionPrice: 800 });

  assert.equal(math.formatQuantity(second.quantity), '5.5000주');
  assert.equal(math.formatPrice(second.averagePrice), '909.09 KRW');
});

test('반대 의견 추가 투자는 POSITION_LOCKED로 거절한다', () => {
  const position = math.calculatePositionAfterOrder({ side: 'MOCK', investmentAmount: 3000, executionPrice: 930 });
  assert.throws(
    () => math.calculatePositionAfterOrder({ position, side: 'SUPPORT', investmentAmount: 1000, executionPrice: 900 }),
    (error) => error.code === 'POSITION_LOCKED',
  );
});

test('옹호 포지션은 가격 상승 시 평가수익이 난다', () => {
  const position = math.calculatePositionAfterOrder({ side: 'SUPPORT', investmentAmount: 3000, executionPrice: 1000 });
  const metrics = math.calculateMetrics({ position, currentPrice: 1200 });

  assert.equal(math.formatKrw(metrics.unrealizedPnl), '+600 KRW');
  assert.equal(math.formatRate(metrics.pnlRate), '+20.00%');
});

test('조롱 포지션은 가격 상승 시 평가손실이 난다', () => {
  const position = math.calculatePositionAfterOrder({ side: 'MOCK', investmentAmount: 3000, executionPrice: 1000 });
  const metrics = math.calculateMetrics({ position, currentPrice: 1200 });

  assert.equal(math.formatKrw(metrics.unrealizedPnl), '-600 KRW');
  assert.equal(math.formatRate(metrics.pnlRate), '-20.00%');
});

test('최대 손실에서도 정산 지급액은 0 KRW 아래로 내려가지 않는다', () => {
  const position = math.calculatePositionAfterOrder({ side: 'MOCK', investmentAmount: 3000, executionPrice: 1000 });
  const settlement = math.calculateSettlement({ position, closePrice: 3000, balanceBeforeSettlement: 7000 });

  assert.equal(math.formatKrwUnsigned(settlement.settlementAmount), '0 KRW');
  assert.equal(settlement.balanceAfterSettlement, '7000');
});
