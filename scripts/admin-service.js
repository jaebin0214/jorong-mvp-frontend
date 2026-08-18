// [관리자 데이터 서비스] 사용자용 서비스와 분리된 관리자 로컬 시연 저장소·상태 전환·Supabase 어댑터 경계입니다.
window.AdminService = (() => {
  const supabaseClient = window.JorongSupabase;
  const STORAGE_KEY = 'jorong_admin_demo_v1';
  // [사용자 화면 로컬 연동] API 미연결 시 가입자·댓글은 사용자용 저장소에서 읽고, 관리자 조작 기록은 별도 저장소에 유지합니다.
  const LOCAL_ACCOUNT_DIRECTORY_KEY = 'jorong-mvp-local-accounts-v1';
  const LOCAL_COMMENT_STORE_KEY = 'jorong-mvp-local-comments-v1';
  // v3: 초기 훈이/사용자 더미를 제거한 빈 운영 상태입니다.
  const STORE_VERSION = 3;
  const OPERATOR = { id: 'admin-local', name: '로컬 운영자', role: '관리자' };
  const MARKET_STATES = Object.freeze({ DRAFT: '초안', SCHEDULED: '예약', LIVE: '거래 중', CLOSED: '종료', SETTLED: '정산 완료', ARCHIVED: '보관' });
  // [시장 상태] 거래 이력이 생긴 종목은 정산 후 ARCHIVED로만 보관합니다.
  // 거래 전 종목의 완전 삭제는 상태 전환이 아니라 deleteMarket()에서 처리합니다.
  const ALLOWED_TRANSITIONS = Object.freeze({ DRAFT: ['SCHEDULED'], SCHEDULED: ['DRAFT', 'LIVE'], LIVE: ['CLOSED'], CLOSED: ['SETTLED'], SETTLED: ['ARCHIVED'], ARCHIVED: [] });
  let memoryStore = null;

  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function createError(code, message) { const error = new Error(message); error.code = code; return error; }
  function pad(value) { return String(value).padStart(2, '0'); }
  function localDate(date) { const value = new Date(date); return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`; }
  function localDateTime(date) { const value = new Date(date); return `${localDate(value)}T${pad(value.getHours())}:${pad(value.getMinutes())}`; }
  function nowIso() { return new Date().toISOString(); }
  function makeId(prefix) { return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`; }

  // [로컬 시연 시드] 실제 사용자 댓글·주문 저장소와 절대 섞지 않는 관리자 전용 빈 운영 상태입니다.
  function createSeed() {
    return {
      version: STORE_VERSION,
      createdAt: nowIso(),
      // 운영자가 종목 관리에서 직접 등록·예약하기 전까지는 표시할 더미 종목이 없습니다.
      markets: [],
      comments: [],
      users: [],
      auditLogs: [],
      participationTrend: [],
    };
  }

  function isCurrentStore(value) {
    return value && value.version === STORE_VERSION && Array.isArray(value.markets) && Array.isArray(value.comments) && Array.isArray(value.users) && Array.isArray(value.auditLogs);
  }

  // [더미 데이터 정리] 이전 v2 시연 저장소의 초기 훈이 종목과 관리자 전용 샘플 사용자를
  // 한 번만 제거합니다. 사용자 화면에서 실제로 가입한 USER_LOCAL 계정은 사용자용 저장소에서
  // 다음 load 시 다시 병합되므로 이 정리 대상이 아닙니다.
  function migrateLegacyStore(value) {
    if (!value || Number(value.version) !== 2) return createSeed();
    const isLegacyHoonMarket = (market) => String(market?.id || '') === 'market_001_hoon';
    const remainingMarkets = Array.isArray(value.markets) ? value.markets.filter((market) => !isLegacyHoonMarket(market)) : [];
    return {
      version: STORE_VERSION,
      createdAt: value.createdAt || nowIso(),
      markets: clone(remainingMarkets),
      // 훈이 시드 회차에 붙어 있던 관리자용 댓글도 함께 제거합니다.
      comments: clone(Array.isArray(value.comments) ? value.comments.filter((comment) => String(comment.marketId || '') !== 'market_001_hoon') : []),
      // 관리자 저장소에만 있던 샘플 사용자는 제거하고, 실제 로컬 가입자만 유지합니다.
      users: clone(Array.isArray(value.users) ? value.users.filter((user) => user.source === 'USER_LOCAL') : []),
      auditLogs: clone(Array.isArray(value.auditLogs) ? value.auditLogs : []),
      participationTrend: [],
    };
  }

  function readStore() {
    if (memoryStore) return clone(memoryStore);
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (isCurrentStore(parsed)) { memoryStore = parsed; return clone(memoryStore); }
        memoryStore = migrateLegacyStore(parsed);
        writeStore(memoryStore);
        return clone(memoryStore);
      }
    } catch (_) { /* localStorage가 막혀도 현재 탭 메모리 시연은 유지합니다. */ }
    memoryStore = createSeed();
    writeStore(memoryStore);
    return clone(memoryStore);
  }

  function writeStore(nextState) {
    memoryStore = clone(nextState);
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(memoryStore)); } catch (_) { /* no-op */ }
  }

  function readSharedLocalData(key, fallback) {
    try {
      const parsed = JSON.parse(window.localStorage.getItem(key) || 'null');
      return parsed || fallback;
    } catch (_) {
      return fallback;
    }
  }

  function writeSharedLocalData(key, value) {
    try { window.localStorage.setItem(key, JSON.stringify(value)); } catch (_) { /* no-op */ }
  }

  function flattenUserComments(comments, callback) {
    (comments || []).forEach((comment) => {
      callback(comment);
      flattenUserComments(comment.replies || [], callback);
    });
  }

  function resolveMarketIdForLocalComment(state, marketSessionId) {
    const matched = state.markets.find((market) => String(market.id) === String(marketSessionId));
    return matched?.id || state.markets.find((market) => market.status === 'LIVE')?.id || state.markets[0]?.id || String(marketSessionId || '');
  }

  // [로컬 사용자 데이터 병합] 사용자 페이지에서 작성한 가입자·댓글을 관리자 조회용 형식으로 변환합니다.
  // 관리자 댓글/조치 기록은 덮어쓰지 않으며, 실제 권한·숨김 판정은 추후 API가 서버에서 처리합니다.
  function syncLocalUserActivity(state) {
    const directory = readSharedLocalData(LOCAL_ACCOUNT_DIRECTORY_KEY, { accounts: [] });
    const commentStore = readSharedLocalData(LOCAL_COMMENT_STORE_KEY, { markets: {} });
    const previousComments = new Map(state.comments.filter((comment) => comment.source === 'USER_LOCAL').map((comment) => [comment.id, comment]));
    const userComments = [];
    Object.entries(commentStore?.markets || {}).forEach(([marketSessionId, bucket]) => {
      flattenUserComments(bucket?.roots || [], (comment) => {
        const prior = previousComments.get(comment.id);
        const author = comment.author || {};
        userComments.push({
          id: String(comment.id),
          marketId: resolveMarketIdForLocalComment(state, comment.marketSessionId || marketSessionId),
          authorId: String(author.id || 'local-user'),
          authorName: String(author.nickname || '익명'),
          authorType: 'USER',
          // 작성자가 직접 삭제한 상태는 운영자 화면에서도 우선 보존해 '삭제'로 표시합니다.
          content: String(comment.status || '').toUpperCase() === 'DELETED' ? '작성자가 삭제한 댓글입니다.' : String(comment.content || ''),
          status: String(comment.status || '').toUpperCase() === 'DELETED' ? 'DELETED' : (prior?.status || 'PUBLIC'),
          reportCount: Number(prior?.reportCount || 0),
          isNotice: false,
          pinned: false,
          hypeCount: Number(comment.hypeCount || 0),
          parentCommentId: comment.parentCommentId || null,
          source: 'USER_LOCAL',
          createdAt: comment.createdAt || nowIso(),
          updatedAt: comment.deletedAt || prior?.updatedAt || comment.createdAt || nowIso(),
          moderationReason: String(comment.status || '').toUpperCase() === 'DELETED' ? '작성자 삭제' : prior?.moderationReason,
          moderatedBy: String(comment.status || '').toUpperCase() === 'DELETED' ? String(author.nickname || '사용자') : prior?.moderatedBy,
        });
      });
    });
    const adminComments = state.comments.filter((comment) => comment.source !== 'USER_LOCAL');
    state.comments = [...userComments, ...adminComments].sort((left, right) => Date.parse(right.createdAt || 0) - Date.parse(left.createdAt || 0));

    const previousUsers = new Map(state.users.filter((user) => user.source === 'USER_LOCAL').map((user) => [user.id, user]));
    const commentCounts = new Map();
    userComments.forEach((comment) => commentCounts.set(comment.authorId, (commentCounts.get(comment.authorId) || 0) + 1));
    const localUsers = Array.isArray(directory?.accounts) ? directory.accounts.map((account) => {
      const previous = previousUsers.get(String(account.id));
      return {
        id: String(account.id),
        nickname: String(account.nickname || '익명'),
        credits: Math.max(0, Math.round(Number(account.points) || 0)),
        tradeCount: Number(previous?.tradeCount || 0),
        commentCount: commentCounts.get(String(account.id)) || 0,
        status: previous?.status || 'ACTIVE',
        commentRestricted: Boolean(previous?.commentRestricted),
        source: 'USER_LOCAL',
        createdAt: account.createdAt || nowIso(),
      };
    }) : [];
    state.users = [...localUsers, ...state.users.filter((user) => user.source !== 'USER_LOCAL')];
    state.markets.forEach((market) => {
      market.commentCount = state.comments.filter((comment) => comment.marketId === market.id && comment.status !== 'DELETED').length;
    });
  }

  function syncSharedAccountCredits(user) {
    if (user.source !== 'USER_LOCAL') return;
    const directory = readSharedLocalData(LOCAL_ACCOUNT_DIRECTORY_KEY, { version: 1, accounts: [] });
    const account = directory.accounts?.find((item) => String(item.id) === String(user.id));
    if (!account) return;
    account.points = Number(user.credits);
    account.updatedAt = nowIso();
    writeSharedLocalData(LOCAL_ACCOUNT_DIRECTORY_KEY, directory);
  }

  function mutate(mutator) {
    const state = readStore();
    const result = mutator(state);
    writeStore(state);
    return result === undefined ? clone(state) : result;
  }

  function appendAudit(state, { category, action, target, detail, operator = OPERATOR.name }) {
    state.auditLogs.unshift({ id: makeId('audit'), category, action, target, detail, operator, createdAt: nowIso() });
  }

  function findMarket(state, marketId) { const market = state.markets.find((item) => item.id === marketId); if (!market) throw createError('MARKET_NOT_FOUND', '대상 종목을 찾을 수 없습니다.'); return market; }
  function findComment(state, commentId) { const comment = state.comments.find((item) => item.id === commentId); if (!comment) throw createError('COMMENT_NOT_FOUND', '대상 댓글을 찾을 수 없습니다.'); return comment; }
  function findUser(state, userId) { const user = state.users.find((item) => item.id === userId); if (!user) throw createError('USER_NOT_FOUND', '대상 사용자를 찾을 수 없습니다.'); return user; }

  // [상태 전환] UI가 status를 직접 변경하지 않고 이 규칙만 통과해야 합니다.
  function canTransitionMarket(currentState, nextState) { return (ALLOWED_TRANSITIONS[currentState] || []).includes(nextState); }
  function transitionMarket(state, market, nextState, action) {
    if (!canTransitionMarket(market.status, nextState)) throw createError('INVALID_MARKET_TRANSITION', `${MARKET_STATES[market.status]} 상태에서는 ${MARKET_STATES[nextState]} 상태로 변경할 수 없습니다.`);
    const previousState = market.status;
    market.status = nextState;
    market.updatedAt = nowIso();
    appendAudit(state, { category: 'MARKET', action, target: `${market.sequence}번 · ${market.subjectName}`, detail: `${MARKET_STATES[previousState]} → ${MARKET_STATES[nextState]}` });
  }

  // [로컬 예약 전환] 실제 운영에서는 서버 스케줄러가 책임지지만, 로컬 시연에서는
  // 관리자 페이지가 열려 있는 동안 예약 시각이 된 다음 종목을 LIVE로 전환합니다.
  function reconcileLocalMarketSchedule(state) {
    const now = Date.now();
    const dueMarket = state.markets
      .filter((market) => market.status === 'SCHEDULED' && market.autoStart && Date.parse(market.startAt || '') <= now)
      .sort((left, right) => Date.parse(left.startAt) - Date.parse(right.startAt))[0];
    if (!dueMarket) return false;

    const liveMarket = state.markets.find((market) => market.status === 'LIVE');
    // 이전 장이 아직 유효하면 새 장을 겹쳐 열지 않습니다.
    if (liveMarket && Date.parse(liveMarket.endAt || '') > now) return false;
    if (liveMarket) {
      liveMarket.closedAt = nowIso();
      transitionMarket(state, liveMarket, 'CLOSED', '예약 시간 종료');
      if (liveMarket.autoSettle) {
        liveMarket.settledAt = nowIso();
        transitionMarket(state, liveMarket, 'SETTLED', '자동 정산 완료');
      }
    }
    validateMarketSchedule({ ...dueMarket, status: 'LIVE' }, state.markets);
    transitionMarket(state, dueMarket, 'LIVE', '예약 시간 자동 시작');
    return true;
  }

  function normalizeIsoDate(value) { const timestamp = Date.parse(value || ''); return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : ''; }

  function normalizeMarketInput(input = {}) {
    return {
      subjectName: String(input.subjectName || '').trim(), shortIntroduction: String(input.shortIntroduction || '').trim(), description: String(input.description || '').trim(), imagePath: String(input.imagePath || '').trim(), operationDate: String(input.operationDate || '').trim(), startAt: normalizeIsoDate(input.startAt), endAt: normalizeIsoDate(input.endAt), basePrice: Math.round(Number(input.basePrice)), minTradeUnit: Math.round(Number(input.minTradeUnit)), settlementMethod: String(input.settlementMethod || '자동 정산'), autoStart: Boolean(input.autoStart), autoSettle: Boolean(input.autoSettle), commentsPublic: Boolean(input.commentsPublic),
    };
  }

  function validateMarketInput(input) {
    const market = normalizeMarketInput(input);
    if (!market.subjectName || !market.imagePath || !market.startAt || !market.endAt) throw createError('MARKET_REQUIRED_FIELDS', '종목명, 이미지, 시작 시각, 종료 시각은 필수입니다.');
    if (!market.shortIntroduction) throw createError('MARKET_REQUIRED_FIELDS', '한 줄 소개를 입력해주세요.');
    if (!Number.isFinite(Date.parse(market.startAt)) || !Number.isFinite(Date.parse(market.endAt))) throw createError('INVALID_MARKET_TIME', '거래 시작·종료 시각을 올바르게 입력해주세요.');
    if (Date.parse(market.endAt) <= Date.parse(market.startAt)) throw createError('INVALID_MARKET_TIME', '거래 종료 시각은 시작 시각보다 늦어야 합니다.');
    if (!Number.isSafeInteger(market.basePrice) || market.basePrice <= 0) throw createError('INVALID_BASE_PRICE', '기준 가격은 1 크레딧 이상의 정수로 입력해주세요.');
    if (!Number.isSafeInteger(market.minTradeUnit) || market.minTradeUnit <= 0) throw createError('INVALID_MIN_TRADE_UNIT', '최소 거래 단위를 올바르게 입력해주세요.');
    market.operationDate = market.operationDate || localDate(market.startAt);
    return market;
  }

  // [예약 충돌 검증] 예약·거래 중 시장의 시간이 겹치거나 LIVE가 둘 이상인 경우를 차단합니다.
  function validateMarketSchedule(candidate, existingMarkets) {
    const candidateStart = Date.parse(candidate.startAt);
    const candidateEnd = Date.parse(candidate.endAt);
    if (!Number.isFinite(candidateStart) || !Number.isFinite(candidateEnd) || candidateEnd <= candidateStart) throw createError('INVALID_MARKET_TIME', '거래 시간을 다시 확인해주세요.');
    const conflicts = existingMarkets.filter((market) => {
      if (market.id === candidate.id || !['SCHEDULED', 'LIVE'].includes(market.status)) return false;
      return candidateStart < Date.parse(market.endAt) && candidateEnd > Date.parse(market.startAt);
    });
    if (conflicts.length) throw createError('MARKET_SCHEDULE_CONFLICT', `예약 시간이 ${conflicts[0].sequence}번 · ${conflicts[0].subjectName} 종목과 겹칩니다.`);
    if (candidate.status === 'LIVE' && existingMarkets.some((market) => market.id !== candidate.id && market.status === 'LIVE')) throw createError('LIVE_MARKET_EXISTS', '한 시점에는 하나의 거래 중 종목만 운영할 수 있습니다.');
    return true;
  }

  // 단순 조회는 관리자 저장소를 다시 쓰지 않습니다. 사용자 탭에서 새 댓글을 쓸 때
  // 관리자 갱신 때문에 거래소 탭이 불필요하게 새로고침되는 것을 막습니다.
  function localLoad() {
    const state = readStore();
    const scheduleChanged = reconcileLocalMarketSchedule(state);
    syncLocalUserActivity(state);
    memoryStore = clone(state);
    if (scheduleChanged) writeStore(memoryStore);
    return clone(state);
  }
  function localCreateMarket(input) { return mutate((state) => { const data = validateMarketInput(input); const sequence = Math.max(0, ...state.markets.map((market) => Number(market.sequence) || 0)) + 1; const market = { id: makeId('market'), sequence, status: 'DRAFT', ...data, participantCount: 0, tradeCount: 0, commentCount: 0, createdAt: nowIso(), updatedAt: nowIso() }; state.markets.push(market); appendAudit(state, { category: 'MARKET', action: '종목 생성', target: `${sequence}번 · ${market.subjectName}`, detail: '초안으로 생성' }); return clone(state); }); }
  function localUpdateDraftMarket(marketId, input) { return mutate((state) => { const market = findMarket(state, marketId); if (market.status !== 'DRAFT') throw createError('MARKET_EDIT_LOCKED', '거래가 시작된 종목은 일반 편집으로 변경할 수 없습니다. 예약 종목은 초안으로 되돌린 뒤 수정해주세요.'); Object.assign(market, validateMarketInput(input), { updatedAt: nowIso() }); appendAudit(state, { category: 'MARKET', action: '종목 수정', target: `${market.sequence}번 · ${market.subjectName}`, detail: '초안 정보 수정' }); return clone(state); }); }
  // [최초 게시] 예약 시각이 이미 지났고 자동 시작이 켜진 첫 종목은 저장 직후 LIVE로 전환합니다.
  // 실제 서비스에서는 이 상태 전환을 서버 스케줄러가 최종 처리합니다.
  function localScheduleMarket(marketId) { return mutate((state) => { const market = findMarket(state, marketId); validateMarketSchedule({ ...market, status: 'SCHEDULED' }, state.markets); transitionMarket(state, market, 'SCHEDULED', '종목 예약'); reconcileLocalMarketSchedule(state); return clone(state); }); }
  function localReturnMarketToDraft(marketId) { return mutate((state) => { const market = findMarket(state, marketId); transitionMarket(state, market, 'DRAFT', '예약 취소'); return clone(state); }); }
  function localStartMarket(marketId) { return mutate((state) => { const market = findMarket(state, marketId); validateMarketSchedule({ ...market, status: 'LIVE' }, state.markets); transitionMarket(state, market, 'LIVE', '거래 시작'); return clone(state); }); }
  // [수동 종료 시각] 거래소가 같은 회차를 종료·정산 화면으로 유지할 수 있도록 실제 운영자가 닫은 시각도 기록합니다.
  function localCloseMarket(marketId) { return mutate((state) => { const market = findMarket(state, marketId); market.closedAt = nowIso(); transitionMarket(state, market, 'CLOSED', '거래 수동 종료'); if (market.autoSettle) { market.settledAt = nowIso(); transitionMarket(state, market, 'SETTLED', '자동 정산 완료'); } return clone(state); }); }
  function localSettleMarket(marketId) { return mutate((state) => { const market = findMarket(state, marketId); market.settledAt = nowIso(); transitionMarket(state, market, 'SETTLED', '정산 완료'); return clone(state); }); }
  // [보관] 정산이 끝난 거래 종목의 이력을 사용자 화면에서 감추되 DB 레코드는 유지합니다.
  function localArchiveMarket(marketId) { return mutate((state) => { const market = findMarket(state, marketId); if (market.status !== 'SETTLED') throw createError('INVALID_MARKET_TRANSITION', '정산 완료된 종목만 보관할 수 있습니다.'); transitionMarket(state, market, 'ARCHIVED', '종목 보관'); market.archivedAt = nowIso(); return clone(state); }); }
  // [완전 삭제] 아직 장이 열리지 않은 종목만 로컬 저장소에서 제거합니다. 종목에 연결된
  // 로컬 댓글도 함께 지워, 다음 로드 때 삭제한 종목이 다시 보이지 않게 합니다.
  function localDeleteMarket(marketId) {
    return mutate((state) => {
      const market = findMarket(state, marketId);
      const isLegacyDeletedMarket = market.status === 'ARCHIVED' && !market.closedAt && !market.settledAt;
      if (!['DRAFT', 'SCHEDULED'].includes(market.status) && !isLegacyDeletedMarket) throw createError('MARKET_DELETE_LOCKED', '거래가 시작되었거나 정산 이력이 있는 종목은 완전히 삭제할 수 없습니다.');
      state.markets = state.markets.filter((item) => item.id !== market.id);
      state.comments = state.comments.filter((comment) => comment.marketId !== market.id);
      state.users.forEach((user) => { user.commentCount = state.comments.filter((comment) => comment.authorId === user.id).length; });
      const commentStore = readSharedLocalData(LOCAL_COMMENT_STORE_KEY, { version: 1, markets: {} });
      if (commentStore?.markets && Object.prototype.hasOwnProperty.call(commentStore.markets, market.id)) {
        delete commentStore.markets[market.id];
        writeSharedLocalData(LOCAL_COMMENT_STORE_KEY, commentStore);
      }
      appendAudit(state, { category: 'MARKET', action: '종목 완전 삭제', target: `${market.sequence}번 · ${market.subjectName}`, detail: '거래 시작 전 종목과 연결된 로컬 댓글 제거' });
      return clone(state);
    });
  }
  function localDuplicateMarket(marketId) { return mutate((state) => { const source = findMarket(state, marketId); const sequence = Math.max(0, ...state.markets.map((market) => Number(market.sequence) || 0)) + 1; const market = { ...clone(source), id: makeId('market'), sequence, status: 'DRAFT', subjectName: `${source.subjectName} 복사본`, participantCount: 0, tradeCount: 0, commentCount: 0, createdAt: nowIso(), updatedAt: nowIso() }; state.markets.push(market); appendAudit(state, { category: 'MARKET', action: '종목 복제', target: `${sequence}번 · ${market.subjectName}`, detail: `${source.sequence}번 종목에서 복제` }); return clone(state); }); }
  function localModerateComment(commentId, { action, reason, operator = OPERATOR.name }) { return mutate((state) => { const comment = findComment(state, commentId); if (!String(reason || '').trim()) throw createError('MODERATION_REASON_REQUIRED', '댓글 처리 사유를 입력해주세요.'); const actionMap = { HIDE: ['HIDDEN', '댓글 숨김'], UNHIDE: ['PUBLIC', '댓글 숨김 해제'], DELETE: ['DELETED', '댓글 소프트 삭제'] }; const next = actionMap[action]; if (!next) throw createError('INVALID_MODERATION_ACTION', '지원하지 않는 댓글 처리입니다.'); comment.status = next[0]; comment.moderationReason = String(reason).trim(); comment.moderatedBy = operator; comment.updatedAt = nowIso(); appendAudit(state, { category: 'COMMENT', action: next[1], target: comment.authorName, detail: `${comment.content.slice(0, 38)} · 사유: ${comment.moderationReason}`, operator }); return clone(state); }); }
  function localCreateStaffComment(input) { return mutate((state) => { const market = findMarket(state, input.marketId); const content = String(input.content || '').trim(); if (!content) throw createError('COMMENT_REQUIRED', '운영진 댓글 내용을 입력해주세요.'); const comment = { id: makeId('admin_comment'), marketId: market.id, authorId: OPERATOR.id, authorName: '조롱 거래소 운영진', authorType: 'ADMIN', operatorName: OPERATOR.name, content, status: input.immediatePublished ? 'PUBLIC' : 'HIDDEN', reportCount: 0, isNotice: Boolean(input.isNotice), pinned: Boolean(input.pinned), publishedImmediately: Boolean(input.immediatePublished), createdAt: nowIso(), updatedAt: nowIso() }; state.comments.unshift(comment); market.commentCount = Number(market.commentCount || 0) + 1; appendAudit(state, { category: 'COMMENT', action: '운영진 댓글 작성', target: `${market.sequence}번 · ${market.subjectName}`, detail: `${comment.isNotice ? '공지 · ' : ''}${content.slice(0, 38)}` }); return clone(state); }); }
  function localAdjustCredits(userId, { amount, reason, operator = OPERATOR.name }) { return mutate((state) => { const user = findUser(state, userId); const adjustment = Math.round(Number(amount)); if (!Number.isSafeInteger(adjustment) || adjustment === 0) throw createError('INVALID_CREDIT_ADJUSTMENT', '0이 아닌 정수 조정 값을 입력해주세요.'); if (!String(reason || '').trim()) throw createError('CREDIT_REASON_REQUIRED', '크레딧 조정 사유를 입력해주세요.'); const before = Number(user.credits); const after = Math.max(0, before + adjustment); user.credits = after; syncSharedAccountCredits(user); appendAudit(state, { category: 'USER', action: '크레딧 조정', target: `${user.nickname} (${user.id})`, detail: `${before.toLocaleString('ko-KR')} → ${after.toLocaleString('ko-KR')} 크레딧 · 조정 ${adjustment > 0 ? '+' : ''}${adjustment.toLocaleString('ko-KR')} · 사유: ${String(reason).trim()}`, operator }); return clone(state); }); }
  function localRestrictUser(userId, { restricted, reason, operator = OPERATOR.name }) { return mutate((state) => { const user = findUser(state, userId); if (!String(reason || '').trim()) throw createError('RESTRICTION_REASON_REQUIRED', '댓글 작성 제한 사유를 입력해주세요.'); user.commentRestricted = Boolean(restricted); user.status = restricted ? 'RESTRICTED' : 'ACTIVE'; appendAudit(state, { category: 'USER', action: restricted ? '댓글 작성 제한' : '댓글 작성 제한 해제', target: `${user.nickname} (${user.id})`, detail: `사유: ${String(reason).trim()}`, operator }); return clone(state); }); }
  function localResetDemo() { const seed = createSeed(); writeStore(seed); return clone(seed); }

  // [RPC 오류 변환] Postgres RAISE EXCEPTION의 'CODE: 설명' 형태 메시지를 코드/한국어 메시지로 분리합니다.
  // 다른 서비스 파일(investment-service.js 등)과 동일한 패턴입니다.
  function parseRpcError(error, fallback) {
    const raw = String(error?.message || '').trim();
    const withDetail = raw.match(/^([A-Z][A-Z0-9_]*)\s*:\s*([\s\S]+)$/);
    if (withDetail) return createError(withDetail[1], withDetail[2].trim());
    if (/^[A-Z][A-Z0-9_]*$/.test(raw)) return createError(raw, fallback);
    return createError(undefined, raw || fallback);
  }

  async function callRpc(name, args) {
    const { data, error } = await supabaseClient.rpc(name, args);
    if (error) throw parseRpcError(error, '관리자 요청을 처리하지 못했습니다.');
    return data || {};
  }

  // [종목 입력 → RPC 페이로드] operationDate/settlementMethod는 DB에 대응 컬럼이 없어 보내지 않습니다.
  // operationDate는 startAt에서, settlementMethod는 autoSettle에서 파생해 화면에 표시합니다
  // (아래 supabaseLoad 참고). 즉 "정산 방식" 선택은 화면 표시만 하고 실제 동작은 "종료 후 자동 정산"
  // 체크박스가 결정합니다 — 두 입력이 다른 값을 가리키면 체크박스 쪽이 우선합니다.
  // [시각 정규화 주의] admin-ui.js의 saveMarket()은 service.validateMarketInput(data)의 반환값을
  // 버리고 원본 폼 입력(readMarketForm())을 그대로 넘깁니다. startAt/endAt은 <input type="datetime-local">
  // 값이라 "2026-08-20T00:00"처럼 타임존이 없는 문자열입니다. 그대로 RPC에 보내면 Postgres가
  // 이를 세션 타임존(UTC) 기준으로 해석해 버려, 관리자의 브라우저 시각과 어긋난 시간이 저장됩니다.
  // 로컬 어댑터는 내부적으로 validateMarketInput()을 다시 호출해 정규화하므로 이 문제가 없고,
  // 여기서도 같은 normalizeIsoDate()로 브라우저 로컬 시각 기준 ISO 문자열로 바꿔서 보냅니다.
  function toMarketPayload(input) {
    return {
      subjectName: input.subjectName,
      shortIntroduction: input.shortIntroduction,
      description: input.description,
      imagePath: input.imagePath,
      startAt: normalizeIsoDate(input.startAt),
      endAt: normalizeIsoDate(input.endAt),
      basePrice: Math.round(Number(input.basePrice)),
      minTradeUnit: Math.round(Number(input.minTradeUnit)),
      autoStart: Boolean(input.autoStart),
      autoSettle: Boolean(input.autoSettle),
      commentsPublic: Boolean(input.commentsPublic),
    };
  }

  async function supabaseLoad() {
    const [marketsBody, commentsBody, usersBody, auditBody] = await Promise.all([
      callRpc('admin_list_markets', {}),
      callRpc('admin_list_comments', {}),
      callRpc('admin_list_users', {}),
      callRpc('admin_list_audit_logs', {}),
    ]);
    const markets = (marketsBody.markets || []).map((market) => ({
      ...market,
      operationDate: market.startAt ? localDate(market.startAt) : '',
      settlementMethod: market.autoSettle ? '자동 정산' : '운영자 확인 후 정산',
    }));
    return { markets, comments: commentsBody.comments || [], users: usersBody.users || [], auditLogs: auditBody.auditLogs || [], participationTrend: [] };
  }

  async function supabaseSetMarketStatus(marketId, nextStatus) { await callRpc('admin_set_market_status', { p_market_id: marketId, p_new_status: nextStatus }); return supabaseLoad(); }
  async function supabaseRestrictUser(userId, { restricted, reason }) {
    if (restricted) await callRpc('admin_restrict_user', { p_user_id: userId, p_type: 'mute', p_reason: reason, p_ends_at: null });
    // 008에는 제한을 해제하는 함수가 없어 013에서 admin_lift_user_restriction()을 추가했습니다.
    else await callRpc('admin_lift_user_restriction', { p_user_id: userId, p_reason: reason });
    return supabaseLoad();
  }

  const supabaseAdapter = {
    load: () => supabaseLoad(),
    // [이미지 업로드] Supabase Storage 버킷을 아직 연결하지 않아 로컬 시연과 동일하게 Data URL로
    // 저장합니다(markets.image_url은 URL 문자열이면 무엇이든 받는 단순 텍스트 컬럼). 요청 본문
    // 크기 제한을 피하기 위해 1.5MB보다 큰 파일은 미리 막습니다. 운영 규모가 커지면 Storage
    // 버킷 + 전용 업로드 절차로 교체하는 것을 권장합니다.
    uploadMarketImage: (file) => {
      if (file && file.size > 1.5 * 1024 * 1024) return Promise.reject(createError('MARKET_IMAGE_TOO_LARGE', '이미지 파일이 너무 큽니다. 1.5MB 이하 이미지를 사용해주세요.'));
      return localUploadMarketImage(file);
    },
    createMarket: async (input) => { await callRpc('admin_create_market', { p_payload: toMarketPayload(input) }); return supabaseLoad(); },
    updateDraftMarket: async (id, input) => { await callRpc('admin_update_market', { p_market_id: id, p_payload: toMarketPayload(input) }); return supabaseLoad(); },
    scheduleMarket: (id) => supabaseSetMarketStatus(id, 'SCHEDULED'),
    returnMarketToDraft: (id) => supabaseSetMarketStatus(id, 'DRAFT'),
    startMarket: (id) => supabaseSetMarketStatus(id, 'LIVE'),
    closeMarket: (id) => supabaseSetMarketStatus(id, 'CLOSED'),
    settleMarket: async (id) => { await callRpc('settle_market', { p_market_id: id }); return supabaseLoad(); },
    archiveMarket: (id) => supabaseSetMarketStatus(id, 'ARCHIVED'),
    // [DB 완전 삭제] 서버는 거래 전 DRAFT/SCHEDULED만 삭제하도록 FK·권한을 검증해야 합니다.
    deleteMarket: async (id) => { await callRpc('admin_delete_market', { p_market_id: id }); return supabaseLoad(); },
    duplicateMarket: async (id) => { await callRpc('admin_duplicate_market', { p_market_id: id }); return supabaseLoad(); },
    // [처리 사유 필수] admin_moderate_comment()는 사유가 비어 있으면 MODERATION_REASON_REQUIRED를 반환합니다.
    moderateComment: async (id, payload) => { await callRpc('admin_moderate_comment', { p_comment_id: id, p_action: payload.action, p_reason: payload.reason }); return supabaseLoad(); },
    // [즉시 게시 안내] admin_create_staff_comment()는 항상 공개 상태로 작성합니다. "즉시 게시" 체크를
    // 해제해도 초안으로 남겨둘 방법이 서버에 없어, 이 값은 현재 무시되고 항상 즉시 게시됩니다.
    createStaffComment: async (input) => { await callRpc('admin_create_staff_comment', { p_market_id: input.marketId, p_content: input.content, p_is_notice: Boolean(input.isNotice), p_pinned: Boolean(input.pinned) }); return supabaseLoad(); },
    adjustCredits: async (id, payload) => { await callRpc('admin_adjust_wallet', { p_user_id: id, p_amount: Math.round(Number(payload.amount)), p_reason: payload.reason, p_idempotency_key: makeId('wallet') }); return supabaseLoad(); },
    restrictUser: (id, payload) => supabaseRestrictUser(id, payload),
  };

  // [로컬 이미지] 시연에서는 Data URL만 보관하되 Supabase 연결 모드와 동일하게 imagePath를 반환합니다.
  function localUploadMarketImage(file) {
    return new Promise((resolve, reject) => {
      if (!file || typeof FileReader === 'undefined') return reject(createError('MARKET_IMAGE_UPLOAD_FAILED', '이미지 파일을 읽을 수 없습니다.'));
      const reader = new FileReader();
      reader.addEventListener('load', () => resolve({ imagePath: String(reader.result || '') }));
      reader.addEventListener('error', () => reject(createError('MARKET_IMAGE_UPLOAD_FAILED', '이미지 파일을 읽지 못했습니다.')));
      reader.readAsDataURL(file);
    });
  }
  const localAdapter = { load: async () => localLoad(), uploadMarketImage: (file) => localUploadMarketImage(file), createMarket: async (input) => localCreateMarket(input), updateDraftMarket: async (id, input) => localUpdateDraftMarket(id, input), scheduleMarket: async (id) => localScheduleMarket(id), returnMarketToDraft: async (id) => localReturnMarketToDraft(id), startMarket: async (id) => localStartMarket(id), closeMarket: async (id) => localCloseMarket(id), settleMarket: async (id) => localSettleMarket(id), archiveMarket: async (id) => localArchiveMarket(id), deleteMarket: async (id) => localDeleteMarket(id), duplicateMarket: async (id) => localDuplicateMarket(id), moderateComment: async (id, payload) => localModerateComment(id, payload), createStaffComment: async (input) => localCreateStaffComment(input), adjustCredits: async (id, payload) => localAdjustCredits(id, payload), restrictUser: async (id, payload) => localRestrictUser(id, payload) };
  function activeAdapter() { return supabaseClient ? supabaseAdapter : localAdapter; }

  return Object.freeze({ MARKET_STATES, canTransitionMarket, validateMarketSchedule, validateMarketInput, localDateTime, getMode: () => supabaseClient ? 'API' : 'LOCAL_DEMO', getOperator: () => clone(OPERATOR), load: () => activeAdapter().load(), uploadMarketImage: (file) => activeAdapter().uploadMarketImage(file), createMarket: (input) => activeAdapter().createMarket(input), updateDraftMarket: (id, input) => activeAdapter().updateDraftMarket(id, input), scheduleMarket: (id) => activeAdapter().scheduleMarket(id), returnMarketToDraft: (id) => activeAdapter().returnMarketToDraft(id), startMarket: (id) => activeAdapter().startMarket(id), closeMarket: (id) => activeAdapter().closeMarket(id), settleMarket: (id) => activeAdapter().settleMarket(id), archiveMarket: (id) => activeAdapter().archiveMarket(id), deleteMarket: (id) => activeAdapter().deleteMarket(id), duplicateMarket: (id) => activeAdapter().duplicateMarket(id), moderateComment: (id, payload) => activeAdapter().moderateComment(id, payload), createStaffComment: (input) => activeAdapter().createStaffComment(input), adjustCredits: (id, payload) => activeAdapter().adjustCredits(id, payload), restrictUser: (id, payload) => activeAdapter().restrictUser(id, payload), resetDemo: () => supabaseClient ? Promise.reject(createError('ADMIN_API_MODE', 'API 연결 모드에서는 시연 데이터를 초기화할 수 없습니다.')) : Promise.resolve(localResetDemo()) });
})();
