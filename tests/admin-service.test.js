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

test('초기 관리자 로컬 상태는 훈이 LIVE 종목 하나와 빈 운영 데이터로 시작한다', async () => {
  const state = await createService().load();
  assert.deepEqual(state.markets.map((market) => ({ id: market.id, subjectName: market.subjectName, status: market.status })), [
    { id: 'market_001_hoon', subjectName: '훈이', status: 'LIVE' },
  ]);
  assert.deepEqual(state.comments, []);
  assert.deepEqual(state.users, []);
  assert.deepEqual(state.auditLogs, []);
  assert.deepEqual(state.participationTrend, []);
});

test('이전 버전의 관리자 더미 저장소는 깨끗한 훈이 초기 상태로 교체한다', async () => {
  const storage = new Map();
  storage.set('jorong_admin_demo_v1', JSON.stringify({ version: 1, markets: [{ id: 'old-demo', status: 'LIVE', subjectName: '이전 더미' }], comments: [{ id: 'old-comment' }], users: [{ id: 'old-user' }], auditLogs: [] }));
  const state = await createService(storage).load();
  assert.equal(state.version, 2);
  assert.deepEqual(state.markets.map((market) => market.id), ['market_001_hoon']);
  assert.deepEqual(state.comments, []);
  assert.deepEqual(state.users, []);
});

test('사용자 거래소의 로컬 가입자와 댓글·답글을 관리자 목록으로 병합한다', async () => {
  const storage = new Map();
  storage.set('jorong-mvp-local-accounts-v1', JSON.stringify({
    version: 1,
    accounts: [{ id: 'local-account-001', nickname: '로컬사용자', points: 7300, createdAt: '2026-08-16T00:00:00.000Z' }],
  }));
  storage.set('jorong-mvp-local-comments-v1', JSON.stringify({
    version: 1,
    markets: {
      market_001_hoon: {
        roots: [{ id: 'local-comment-1', marketSessionId: 'market_001_hoon', content: '훈이 댓글', author: { id: 'local-account-001', nickname: '로컬사용자' }, hypeCount: 2, createdAt: '2026-08-16T01:00:00.000Z', replies: [{ id: 'local-comment-2', marketSessionId: 'market_001_hoon', parentCommentId: 'local-comment-1', content: '훈이 답글', author: { id: 'local-account-001', nickname: '로컬사용자' }, hypeCount: 0, createdAt: '2026-08-16T01:01:00.000Z', replies: [] }] }],
      },
    },
  }));
  const state = await createService(storage).load();
  assert.equal(state.users[0].nickname, '로컬사용자');
  assert.equal(state.users[0].credits, 7300);
  assert.equal(state.users[0].commentCount, 2);
  assert.equal(state.comments.length, 2);
  assert.equal(state.comments[0].authorName, '로컬사용자');
  assert.equal(state.markets[0].commentCount, 2);
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
  const initial = await service.load();
  const live = initial.markets.find((market) => market.status === 'LIVE');
  const startAt = new Date(Date.parse(live.endAt) + (60 * 60 * 1000)).toISOString();
  const endAt = new Date(Date.parse(startAt) + (60 * 60 * 1000)).toISOString();
  const created = await service.createMarket({ subjectName: '테스트 종목', shortIntroduction: '상태 전환 검증용 종목', description: 'LIVE 상태 중복 방지 검증입니다.', imagePath: './assets/hoon.png', startAt, endAt, basePrice: 1000, minTradeUnit: 10, settlementMethod: '자동 정산', autoStart: true, autoSettle: true, commentsPublic: true });
  const candidate = created.markets.find((market) => market.subjectName === '테스트 종목');
  await service.scheduleMarket(candidate.id);
  await assert.rejects(service.startMarket(candidate.id), (error) => error.code === 'LIVE_MARKET_EXISTS');
});

test('이전 LIVE 장이 끝난 뒤에는 자동 시작 예약 종목을 다음 LIVE 장으로 전환한다', async () => {
  const storage = new Map();
  const now = Date.now();
  storage.set('jorong_admin_demo_v1', JSON.stringify({
    version: 2,
    markets: [
      { id: 'market-old', sequence: 1, status: 'LIVE', subjectName: '이전 종목', shortIntroduction: '이전 장', description: '', imagePath: './assets/hoon.png', startAt: new Date(now - 7200000).toISOString(), endAt: new Date(now - 3600000).toISOString(), basePrice: 1000, minTradeUnit: 10, settlementMethod: '자동 정산', autoStart: true, autoSettle: true, commentsPublic: true },
      { id: 'market-next', sequence: 2, status: 'SCHEDULED', subjectName: '다음 종목', shortIntroduction: '다음 장', description: '', imagePath: './assets/hoon.png', startAt: new Date(now - 60000).toISOString(), endAt: new Date(now + 3600000).toISOString(), basePrice: 1000, minTradeUnit: 10, settlementMethod: '자동 정산', autoStart: true, autoSettle: true, commentsPublic: true },
    ],
    comments: [], users: [], auditLogs: [], participationTrend: [],
  }));
  const state = await createService(storage).load();
  assert.equal(state.markets.find((market) => market.id === 'market-old').status, 'SETTLED');
  assert.equal(state.markets.find((market) => market.id === 'market-next').status, 'LIVE');
});

test('댓글 숨김과 숨김 해제는 감사 기록을 남긴다', async () => {
  const service = createService();
  const initial = await service.load();
  let state = await service.createStaffComment({ marketId: initial.markets[0].id, content: '검토할 운영진 댓글', isNotice: false, pinned: false, immediatePublished: true });
  const commentId = state.comments[0].id;
  state = await service.moderateComment(commentId, { action: 'HIDE', reason: '검토 필요' });
  assert.equal(state.comments.find((comment) => comment.id === commentId).status, 'HIDDEN');
  assert.equal(state.auditLogs[0].action, '댓글 숨김');
  state = await service.moderateComment(commentId, { action: 'UNHIDE', reason: '검토 완료' });
  assert.equal(state.comments.find((comment) => comment.id === commentId).status, 'PUBLIC');
  assert.equal(state.auditLogs[0].action, '댓글 숨김 해제');
});

test('크레딧 조정에는 사유가 필요하고 변경 전후 값이 운영 기록에 남는다', async () => {
  const storage = new Map();
  await createService(storage).load();
  const seeded = JSON.parse(storage.get('jorong_admin_demo_v1'));
  seeded.users.push({ id: 'test_user_001', nickname: '테스트 사용자', credits: 8400, tradeCount: 0, commentCount: 0, status: 'ACTIVE', commentRestricted: false, createdAt: new Date().toISOString() });
  storage.set('jorong_admin_demo_v1', JSON.stringify(seeded));
  const service = createService(storage);
  await assert.rejects(service.adjustCredits('test_user_001', { amount: 1000, reason: '' }), (error) => error.code === 'CREDIT_REASON_REQUIRED');
  const state = await service.adjustCredits('test_user_001', { amount: -400, reason: '운영 보정' });
  assert.equal(state.users.find((user) => user.id === 'test_user_001').credits, 8000);
  assert.match(state.auditLogs[0].detail, /8,400 → 8,000 KRW/);
});

test('관리자 로컬 시연 데이터는 새 서비스 인스턴스에서도 복원된다', async () => {
  const sharedStorage = new Map();
  const firstService = createService(sharedStorage);
  const initial = await firstService.load();
  const state = await firstService.createStaffComment({ marketId: initial.markets[0].id, content: '새로고침 복원 확인용 댓글', isNotice: false, pinned: false, immediatePublished: true });
  const commentId = state.comments[0].id;
  await firstService.moderateComment(commentId, { action: 'HIDE', reason: '새로고침 복원 확인' });
  const restoredService = createService(sharedStorage);
  const restored = await restoredService.load();
  assert.equal(restored.comments.find((comment) => comment.id === commentId).status, 'HIDDEN');
  assert.equal(restored.auditLogs[0].action, '댓글 숨김');
});
