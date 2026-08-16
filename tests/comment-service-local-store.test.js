// [로컬 댓글 저장소 테스트] 사용자 거래소가 저장한 댓글 트리를 관리자 병합용 localStorage에 남기는지 검증합니다.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function createCommentService(storage = new Map()) {
  let account = { id: 'local-account-001', nickname: '로컬사용자', points: 10000 };
  const sandbox = {
    window: {
      JORONG_API_BASE_URL: '',
      localStorage: { getItem: (key) => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) },
      MarketConfig: { get: () => ({ session: { id: 'market_001_hoon' }, subject: { id: 'market_001_hoon' } }) },
      MarketCountdown: { getSessionId: () => 'market_001_hoon', requiresServerClock: () => false, isEnded: () => false },
      AuthService: { getCurrentAccount: () => account, getRequestHeaders: () => ({}) },
    },
    JSON,
    Date,
    Math,
    String,
    Number,
    Object,
  };
  const source = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'comment-service.js'), 'utf8');
  vm.runInNewContext(source, sandbox, { filename: 'comment-service.js' });
  return {
    service: sandbox.window.CommentService,
    setAccount: (nextAccount) => { account = nextAccount; },
  };
}

test('로컬 작성 댓글과 답글은 회차별 shared localStorage에 저장된다', async () => {
  const storage = new Map();
  const { service } = createCommentService(storage);
  const root = await service.createComment({ targetId: service.TARGET_ID, marketSessionId: service.getMarketSessionId(), content: '원댓글' });
  await service.createComment({ targetId: service.TARGET_ID, marketSessionId: service.getMarketSessionId(), parentCommentId: root.comment.id, content: '답글' });

  const stored = JSON.parse(storage.get('jorong-mvp-local-comments-v1'));
  const roots = stored.markets.market_001_hoon.roots;
  assert.equal(roots.length, 1);
  assert.equal(roots[0].author.nickname, '로컬사용자');
  assert.equal(roots[0].replies[0].content, '답글');
});

test('로컬 댓글 삭제는 작성자만 할 수 있고 삭제 상태를 보존한다', async () => {
  const storage = new Map();
  const { service, setAccount } = createCommentService(storage);
  const root = await service.createComment({ targetId: service.TARGET_ID, marketSessionId: service.getMarketSessionId(), content: '작성자 댓글' });

  setAccount({ id: 'local-account-002', nickname: '다른사용자', points: 10000 });
  await assert.rejects(
    service.deleteComment(root.comment.id),
    (error) => error.code === 'COMMENT_DELETE_FORBIDDEN',
  );

  setAccount({ id: 'local-account-001', nickname: '로컬사용자', points: 10000 });
  await service.deleteComment(root.comment.id);
  const stored = JSON.parse(storage.get('jorong-mvp-local-comments-v1'));
  const savedComment = stored.markets.market_001_hoon.roots[0];
  assert.equal(savedComment.status, 'DELETED');
  assert.equal(savedComment.author.id, 'local-account-001');
  assert.equal(service.getMyCommentsForMarket('market_001_hoon')[0].status, 'DELETED');
});
