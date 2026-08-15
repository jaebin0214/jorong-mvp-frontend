// [관리자 서비스 테스트] 로컬 시연 모드의 상태 전환·예약 충돌·댓글·크레딧 감사 로그를 Node 기본 테스트로 검증합니다.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function createService(storage = new Map()) {
  const sandbox = {
    window: {
      JORONG_API_BASE_URL: '',
      localStorage: { getItem: (key) => storage.get(key) || null, setItem: (key, value) => storage.set(key, value), removeItem: (key) => storage.delete(key) },
    },
    Date,
    JSON,
    Math,
  };
  const source = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'admin-service.js'), 'utf8');
  vm.runInNewContext(source, sandbox, { filename: 'admin-service.js' });
  return sandbox.window.AdminService;
}

test('관리자 시장 상태 전환은 허용된 순서만 통과한다', () => {
  const service = createService();
  assert.equal(service.canTransitionMarket('DRAFT', 'SCHEDULED'), true);
  assert.equal(service.canTransitionMarket('LIVE', 'CLOSED'), true);
  assert.equal(service.canTransitionMarket('LIVE', 'SETTLED'), false);
  assert.equal(service.canTransitionMarket('ARCHIVED', 'DRAFT'), false);
});

test('예약 또는 거래 중인 종목과 시간이 겹치면 예약을 차단한다', async () => {
  const service = createService();
  const state = await service.load();
  const live = state.markets.find((market) => market.status === 'LIVE');
  assert.throws(
    () => service.validateMarketSchedule({ id: 'candidate', status: 'SCHEDULED', startAt: live.startAt, endAt: live.endAt }, state.markets),
    (error) => error.code === 'MARKET_SCHEDULE_CONFLICT',
  );
});

test('종목 필수값과 시작·종료 시간 검증이 작동한다', () => {
  const service = createService();
  assert.throws(
    () => service.validateMarketInput({ subjectName: '테스트', shortIntroduction: '소개', imagePath: '', startAt: '2026-08-15T13:00', endAt: '2026-08-15T14:00', basePrice: 1000, minTradeUnit: 10 }),
    (error) => error.code === 'MARKET_REQUIRED_FIELDS',
  );
  assert.throws(
    () => service.validateMarketInput({ subjectName: '테스트', shortIntroduction: '소개', imagePath: './assets/hoon.png', startAt: '2026-08-15T14:00', endAt: '2026-08-15T13:00', basePrice: 1000, minTradeUnit: 10 }),
    (error) => error.code === 'INVALID_MARKET_TIME',
  );
});

test('한 번에 두 종목을 LIVE 상태로 시작할 수 없다', async () => {
  const service = createService();
  await service.load();
  await assert.rejects(service.startMarket('market_008_yuri'), (error) => error.code === 'LIVE_MARKET_EXISTS');
});

test('댓글 숨김과 숨김 해제는 감사 기록을 남긴다', async () => {
  const service = createService();
  await service.load();
  let state = await service.moderateComment('admin_comment_001', { action: 'HIDE', reason: '검토 필요' });
  assert.equal(state.comments.find((comment) => comment.id === 'admin_comment_001').status, 'HIDDEN');
  assert.equal(state.auditLogs[0].action, '댓글 숨김');
  state = await service.moderateComment('admin_comment_001', { action: 'UNHIDE', reason: '검토 완료' });
  assert.equal(state.comments.find((comment) => comment.id === 'admin_comment_001').status, 'PUBLIC');
  assert.equal(state.auditLogs[0].action, '댓글 숨김 해제');
});

test('크레딧 조정에는 사유가 필요하고 변경 전후 값이 운영 기록에 남는다', async () => {
  const service = createService();
  await service.load();
  await assert.rejects(service.adjustCredits('user_001', { amount: 1000, reason: '' }), (error) => error.code === 'CREDIT_REASON_REQUIRED');
  const state = await service.adjustCredits('user_001', { amount: -400, reason: '운영 보정' });
  assert.equal(state.users.find((user) => user.id === 'user_001').credits, 8000);
  assert.match(state.auditLogs[0].detail, /8,400 → 8,000 KRW/);
});

test('관리자 로컬 시연 데이터는 새 서비스 인스턴스에서도 복원된다', async () => {
  const sharedStorage = new Map();
  const firstService = createService(sharedStorage);
  await firstService.load();
  await firstService.moderateComment('admin_comment_002', { action: 'HIDE', reason: '새로고침 복원 확인' });
  const restoredService = createService(sharedStorage);
  const restored = await restoredService.load();
  assert.equal(restored.comments.find((comment) => comment.id === 'admin_comment_002').status, 'HIDDEN');
  assert.equal(restored.auditLogs[0].action, '댓글 숨김');
});
