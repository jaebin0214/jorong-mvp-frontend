// [최초가격 대비 변동 UI 테스트] 직전 주문 가격이 같아도 개장 기준가 대비 누적 변동률을 표시해야 합니다.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'target-value-ui.js'), 'utf8');

function loadUi(initialPrice = 1000) {
  const elements = new Map();
  ['#exchange-current-price', '#exchange-price-pin', '#exchange-price-change', '#mobile-current-price', '#mobile-price-change'].forEach((selector) => {
    elements.set(selector, {
      textContent: '',
      classList: { values: new Set(), toggle(name, enabled) { if (enabled) this.values.add(name); else this.values.delete(name); } },
    });
  });
  const window = { MarketConfig: { get: () => ({ subject: { initialPrice } }) } };
  const document = { querySelector: (selector) => elements.get(selector) || null };
  vm.runInNewContext(source, { window, document, Number, String, Math });
  return { ui: window.TargetValueUI, elements };
}

test('변동 금액과 비율은 직전 가격이 아닌 최초가격을 기준으로 표시한다', () => {
  const { ui, elements } = loadUi(1000);
  // previousValue가 현재가와 같아도 1,000 → 1,100의 누적 변화는 +10%여야 합니다.
  ui.update({ value: 1100, previousValue: 1100 });
  assert.equal(elements.get('#exchange-price-change').textContent, '+100 크레딧 (+10.00%)');
  assert.equal(elements.get('#mobile-price-change').textContent, '+100 크레딧 (+10.00%)');
});

test('주문 응답의 base_price가 있으면 운영 설정보다 우선한다', () => {
  const { ui, elements } = loadUi(1000);
  ui.update({ value: 1200, base_price: 800 });
  assert.equal(elements.get('#exchange-price-change').textContent, '+400 크레딧 (+50.00%)');
});
