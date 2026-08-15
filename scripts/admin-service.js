// [관리자 데이터 서비스] 사용자용 서비스와 분리된 관리자 로컬 시연 저장소·상태 전환·API 어댑터 경계입니다.
window.AdminService = (() => {
  const API_BASE_URL = (window.JORONG_API_BASE_URL || '').replace(/\/$/, '');
  const ADMIN_API_ENABLED = Boolean(API_BASE_URL && window.JORONG_ADMIN_API_ENABLED === true);
  const STORAGE_KEY = 'jorong_admin_demo_v1';
  const OPERATOR = { id: 'admin-local', name: '로컬 데모 운영자', role: '관리자' };
  const MARKET_STATES = Object.freeze({ DRAFT: '초안', SCHEDULED: '예약', LIVE: '거래 중', CLOSED: '종료', SETTLED: '정산 완료', ARCHIVED: '보관' });
  const ALLOWED_TRANSITIONS = Object.freeze({ DRAFT: ['SCHEDULED'], SCHEDULED: ['DRAFT', 'LIVE'], LIVE: ['CLOSED'], CLOSED: ['SETTLED'], SETTLED: ['ARCHIVED'], ARCHIVED: [] });
  let memoryStore = null;

  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function createError(code, message) { const error = new Error(message); error.code = code; return error; }
  function pad(value) { return String(value).padStart(2, '0'); }
  function localDate(date) { const value = new Date(date); return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`; }
  function localDateTime(date) { const value = new Date(date); return `${localDate(value)}T${pad(value.getHours())}:${pad(value.getMinutes())}`; }
  function addHours(date, hours) { return new Date(new Date(date).getTime() + (hours * 60 * 60 * 1000)); }
  function nowIso() { return new Date().toISOString(); }
  function makeId(prefix) { return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`; }

  // [로컬 시연 시드] 실제 사용자 댓글·주문 저장소와 절대 섞지 않는 관리자 전용 데이터입니다.
  function createSeed() {
    const now = new Date();
    const liveStart = addHours(now, -2);
    const liveEnd = addHours(now, 1.25);
    const nextStart = addHours(now, 3);
    const nextEnd = addHours(nextStart, 2);
    const secondStart = addHours(now, 6.5);
    const secondEnd = addHours(secondStart, 2);
    const closedStart = addHours(now, -30);
    const closedEnd = addHours(now, -28);
    const settledStart = addHours(now, -54);
    const settledEnd = addHours(now, -52);
    return {
      version: 1,
      createdAt: nowIso(),
      markets: [
        { id: 'market_007_hoon', sequence: 7, status: 'LIVE', subjectName: '훈이', shortIntroduction: '참을 수 없는 자신감, 과연 시장의 평가는?', description: '짱구는 못말려의 훈이를 오늘의 조롱 거래소 종목으로 소개합니다.', imagePath: './assets/hoon.png', operationDate: localDate(liveStart), startAt: liveStart.toISOString(), endAt: liveEnd.toISOString(), basePrice: 1000, minTradeUnit: 10, settlementMethod: '자동 정산', autoStart: true, autoSettle: true, commentsPublic: true, participantCount: 128, tradeCount: 842, commentCount: 36, createdAt: nowIso(), updatedAt: nowIso() },
        { id: 'market_008_yuri', sequence: 8, status: 'SCHEDULED', subjectName: '유리', shortIntroduction: '단단한 원칙과 한마디의 반전', description: '다음 회차 종목 소개 예시입니다.', imagePath: '', operationDate: localDate(nextStart), startAt: nextStart.toISOString(), endAt: nextEnd.toISOString(), basePrice: 1200, minTradeUnit: 10, settlementMethod: '자동 정산', autoStart: true, autoSettle: true, commentsPublic: true, participantCount: 0, tradeCount: 0, commentCount: 0, createdAt: nowIso(), updatedAt: nowIso() },
        { id: 'market_009_maenggu', sequence: 9, status: 'DRAFT', subjectName: '맹구', shortIntroduction: '알 수 없는 표정의 시장 반응', description: '운영 검토 중인 종목 초안입니다.', imagePath: '', operationDate: localDate(secondStart), startAt: secondStart.toISOString(), endAt: secondEnd.toISOString(), basePrice: 950, minTradeUnit: 10, settlementMethod: '자동 정산', autoStart: false, autoSettle: true, commentsPublic: true, participantCount: 0, tradeCount: 0, commentCount: 0, createdAt: nowIso(), updatedAt: nowIso() },
        { id: 'market_006_chulsoo', sequence: 6, status: 'CLOSED', subjectName: '철수', shortIntroduction: '철저한 분석, 시장은 동의했을까?', description: '마감되어 정산 대기 중인 종목입니다.', imagePath: '', operationDate: localDate(closedStart), startAt: closedStart.toISOString(), endAt: closedEnd.toISOString(), basePrice: 1100, minTradeUnit: 10, settlementMethod: '운영자 확인 후 정산', autoStart: true, autoSettle: false, commentsPublic: true, participantCount: 97, tradeCount: 622, commentCount: 28, createdAt: nowIso(), updatedAt: nowIso() },
        { id: 'market_005_jjanggu', sequence: 5, status: 'SETTLED', subjectName: '짱구', shortIntroduction: '예측 불가한 한 방', description: '정산 완료된 과거 회차입니다.', imagePath: '', operationDate: localDate(settledStart), startAt: settledStart.toISOString(), endAt: settledEnd.toISOString(), basePrice: 1000, minTradeUnit: 10, settlementMethod: '자동 정산', autoStart: true, autoSettle: true, commentsPublic: true, participantCount: 168, tradeCount: 1260, commentCount: 74, createdAt: nowIso(), updatedAt: nowIso() },
      ],
      comments: [
        { id: 'admin_comment_001', marketId: 'market_007_hoon', authorId: 'user_001', authorName: '웃긴개미_241', authorType: 'USER', content: '오늘은 자신감이 너무 과한데요. 시장이 냉정하게 평가해줄 듯!', status: 'PUBLIC', reportCount: 0, isNotice: false, pinned: false, createdAt: addHours(now, -1.3).toISOString(), updatedAt: nowIso() },
        { id: 'admin_comment_002', marketId: 'market_007_hoon', authorId: 'user_002', authorName: '밈전문투자단', authorType: 'USER', content: '캐릭터를 향한 과도한 비난 표현', status: 'FLAGGED', reportCount: 3, isNotice: false, pinned: false, createdAt: addHours(now, -1.0).toISOString(), updatedAt: nowIso() },
        { id: 'admin_comment_003', marketId: 'market_007_hoon', authorId: 'admin-local', authorName: '조롱 거래소 운영진', authorType: 'ADMIN', content: '건전한 대화와 유쾌한 조롱을 부탁드립니다.', status: 'PUBLIC', reportCount: 0, isNotice: true, pinned: true, publishedImmediately: true, operatorName: OPERATOR.name, createdAt: addHours(now, -0.8).toISOString(), updatedAt: nowIso() },
        { id: 'admin_comment_004', marketId: 'market_006_chulsoo', authorId: 'user_003', authorName: '차트는감성', authorType: 'USER', content: '운영 검토로 숨김 처리된 댓글입니다.', status: 'HIDDEN', reportCount: 1, isNotice: false, pinned: false, createdAt: addHours(now, -28.5).toISOString(), updatedAt: nowIso() },
      ],
      users: [
        { id: 'user_001', nickname: '웃긴개미_241', credits: 8400, tradeCount: 7, commentCount: 12, status: 'ACTIVE', commentRestricted: false, createdAt: addHours(now, -240).toISOString() },
        { id: 'user_002', nickname: '밈전문투자단', credits: 12500, tradeCount: 11, commentCount: 18, status: 'ACTIVE', commentRestricted: false, createdAt: addHours(now, -420).toISOString() },
        { id: 'user_003', nickname: '차트는감성', credits: 3200, tradeCount: 4, commentCount: 9, status: 'RESTRICTED', commentRestricted: true, createdAt: addHours(now, -700).toISOString() },
        { id: 'user_004', nickname: '웃음저격수', credits: 10000, tradeCount: 1, commentCount: 2, status: 'ACTIVE', commentRestricted: false, createdAt: addHours(now, -72).toISOString() },
      ],
      auditLogs: [],
      participationTrend: [38, 54, 68, 81, 63, 92],
    };
  }

  function readStore() {
    if (memoryStore) return clone(memoryStore);
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved) { memoryStore = JSON.parse(saved); return clone(memoryStore); }
    } catch (_) { /* localStorage가 막혀도 현재 탭 메모리 시연은 유지합니다. */ }
    memoryStore = createSeed();
    writeStore(memoryStore);
    return clone(memoryStore);
  }

  function writeStore(nextState) {
    memoryStore = clone(nextState);
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(memoryStore)); } catch (_) { /* no-op */ }
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
    if (!Number.isSafeInteger(market.basePrice) || market.basePrice <= 0) throw createError('INVALID_BASE_PRICE', '기준 가격은 1 KRW 이상의 정수로 입력해주세요.');
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

  function localLoad() { return clone(readStore()); }
  function localCreateMarket(input) { return mutate((state) => { const data = validateMarketInput(input); const sequence = Math.max(0, ...state.markets.map((market) => Number(market.sequence) || 0)) + 1; const market = { id: makeId('market'), sequence, status: 'DRAFT', ...data, participantCount: 0, tradeCount: 0, commentCount: 0, createdAt: nowIso(), updatedAt: nowIso() }; state.markets.push(market); appendAudit(state, { category: 'MARKET', action: '종목 생성', target: `${sequence}번 · ${market.subjectName}`, detail: '초안으로 생성' }); return clone(state); }); }
  function localUpdateDraftMarket(marketId, input) { return mutate((state) => { const market = findMarket(state, marketId); if (market.status !== 'DRAFT') throw createError('MARKET_EDIT_LOCKED', '거래가 시작된 종목은 일반 편집으로 변경할 수 없습니다. 예약 종목은 초안으로 되돌린 뒤 수정해주세요.'); Object.assign(market, validateMarketInput(input), { updatedAt: nowIso() }); appendAudit(state, { category: 'MARKET', action: '종목 수정', target: `${market.sequence}번 · ${market.subjectName}`, detail: '초안 정보 수정' }); return clone(state); }); }
  function localScheduleMarket(marketId) { return mutate((state) => { const market = findMarket(state, marketId); validateMarketSchedule({ ...market, status: 'SCHEDULED' }, state.markets); transitionMarket(state, market, 'SCHEDULED', '종목 예약'); return clone(state); }); }
  function localReturnMarketToDraft(marketId) { return mutate((state) => { const market = findMarket(state, marketId); transitionMarket(state, market, 'DRAFT', '예약 취소'); return clone(state); }); }
  function localStartMarket(marketId) { return mutate((state) => { const market = findMarket(state, marketId); validateMarketSchedule({ ...market, status: 'LIVE' }, state.markets); transitionMarket(state, market, 'LIVE', '거래 시작'); return clone(state); }); }
  function localCloseMarket(marketId) { return mutate((state) => { const market = findMarket(state, marketId); transitionMarket(state, market, 'CLOSED', '거래 수동 종료'); if (market.autoSettle) transitionMarket(state, market, 'SETTLED', '자동 정산 완료'); return clone(state); }); }
  function localSettleMarket(marketId) { return mutate((state) => { const market = findMarket(state, marketId); transitionMarket(state, market, 'SETTLED', '정산 완료'); return clone(state); }); }
  function localArchiveMarket(marketId) { return mutate((state) => { const market = findMarket(state, marketId); transitionMarket(state, market, 'ARCHIVED', '종목 보관'); return clone(state); }); }
  function localDuplicateMarket(marketId) { return mutate((state) => { const source = findMarket(state, marketId); const sequence = Math.max(0, ...state.markets.map((market) => Number(market.sequence) || 0)) + 1; const market = { ...clone(source), id: makeId('market'), sequence, status: 'DRAFT', subjectName: `${source.subjectName} 복사본`, participantCount: 0, tradeCount: 0, commentCount: 0, createdAt: nowIso(), updatedAt: nowIso() }; state.markets.push(market); appendAudit(state, { category: 'MARKET', action: '종목 복제', target: `${sequence}번 · ${market.subjectName}`, detail: `${source.sequence}번 종목에서 복제` }); return clone(state); }); }
  function localModerateComment(commentId, { action, reason, operator = OPERATOR.name }) { return mutate((state) => { const comment = findComment(state, commentId); if (!String(reason || '').trim()) throw createError('MODERATION_REASON_REQUIRED', '댓글 처리 사유를 입력해주세요.'); const actionMap = { HIDE: ['HIDDEN', '댓글 숨김'], UNHIDE: ['PUBLIC', '댓글 숨김 해제'], DELETE: ['DELETED', '댓글 소프트 삭제'] }; const next = actionMap[action]; if (!next) throw createError('INVALID_MODERATION_ACTION', '지원하지 않는 댓글 처리입니다.'); comment.status = next[0]; comment.moderationReason = String(reason).trim(); comment.moderatedBy = operator; comment.updatedAt = nowIso(); appendAudit(state, { category: 'COMMENT', action: next[1], target: comment.authorName, detail: `${comment.content.slice(0, 38)} · 사유: ${comment.moderationReason}`, operator }); return clone(state); }); }
  function localCreateStaffComment(input) { return mutate((state) => { const market = findMarket(state, input.marketId); const content = String(input.content || '').trim(); if (!content) throw createError('COMMENT_REQUIRED', '운영진 댓글 내용을 입력해주세요.'); const comment = { id: makeId('admin_comment'), marketId: market.id, authorId: OPERATOR.id, authorName: '조롱 거래소 운영진', authorType: 'ADMIN', operatorName: OPERATOR.name, content, status: input.immediatePublished ? 'PUBLIC' : 'HIDDEN', reportCount: 0, isNotice: Boolean(input.isNotice), pinned: Boolean(input.pinned), publishedImmediately: Boolean(input.immediatePublished), createdAt: nowIso(), updatedAt: nowIso() }; state.comments.unshift(comment); market.commentCount = Number(market.commentCount || 0) + 1; appendAudit(state, { category: 'COMMENT', action: '운영진 댓글 작성', target: `${market.sequence}번 · ${market.subjectName}`, detail: `${comment.isNotice ? '공지 · ' : ''}${content.slice(0, 38)}` }); return clone(state); }); }
  function localAdjustCredits(userId, { amount, reason, operator = OPERATOR.name }) { return mutate((state) => { const user = findUser(state, userId); const adjustment = Math.round(Number(amount)); if (!Number.isSafeInteger(adjustment) || adjustment === 0) throw createError('INVALID_CREDIT_ADJUSTMENT', '0이 아닌 정수 조정 값을 입력해주세요.'); if (!String(reason || '').trim()) throw createError('CREDIT_REASON_REQUIRED', '크레딧 조정 사유를 입력해주세요.'); const before = Number(user.credits); const after = Math.max(0, before + adjustment); user.credits = after; appendAudit(state, { category: 'USER', action: '크레딧 조정', target: `${user.nickname} (${user.id})`, detail: `${before.toLocaleString('ko-KR')} → ${after.toLocaleString('ko-KR')} KRW · 조정 ${adjustment > 0 ? '+' : ''}${adjustment.toLocaleString('ko-KR')} · 사유: ${String(reason).trim()}`, operator }); return clone(state); }); }
  function localRestrictUser(userId, { restricted, reason, operator = OPERATOR.name }) { return mutate((state) => { const user = findUser(state, userId); if (!String(reason || '').trim()) throw createError('RESTRICTION_REASON_REQUIRED', '댓글 작성 제한 사유를 입력해주세요.'); user.commentRestricted = Boolean(restricted); user.status = restricted ? 'RESTRICTED' : 'ACTIVE'; appendAudit(state, { category: 'USER', action: restricted ? '댓글 작성 제한' : '댓글 작성 제한 해제', target: `${user.nickname} (${user.id})`, detail: `사유: ${String(reason).trim()}`, operator }); return clone(state); }); }
  function localResetDemo() { const seed = createSeed(); writeStore(seed); return clone(seed); }

  // [HTTP 어댑터] window.JORONG_ADMIN_API_ENABLED=true일 때만 실제 관리자 API로 바뀝니다.
  async function request(path, options = {}) {
    let token = '';
    try { token = window.sessionStorage.getItem('jorong-mvp-access-token') || ''; } catch (_) { /* no-op */ }
    const response = await fetch(`${API_BASE_URL}${path}`, { credentials: 'include', ...options, headers: { Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(options.headers || {}) } });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 401) throw createError('ADMIN_AUTH_REQUIRED', '관리자 로그인 세션이 필요합니다.');
      if (response.status === 403) throw createError('ADMIN_FORBIDDEN', '이 계정에는 관리자 권한이 없습니다.');
      throw createError(body.code || 'ADMIN_API_ERROR', body.message || '관리자 요청을 처리하지 못했습니다.');
    }
    return body;
  }
  const httpAdapter = {
    async load() { const [dashboard, markets, comments, users, auditLogs] = await Promise.all([request('/admin/dashboard'), request('/admin/markets'), request('/admin/comments'), request('/admin/users'), request('/admin/audit-logs')]); return { ...dashboard, markets: markets.markets || markets.data || [], comments: comments.comments || comments.data || [], users: users.users || users.data || [], auditLogs: auditLogs.logs || auditLogs.data || [], participationTrend: dashboard.participationTrend || [] }; },
    async createMarket(input) { await request('/admin/markets', { method: 'POST', body: JSON.stringify(input) }); return this.load(); }, async updateDraftMarket(id, input) { await request(`/admin/markets/${id}`, { method: 'PATCH', body: JSON.stringify(input) }); return this.load(); }, async scheduleMarket(id) { await request(`/admin/markets/${id}/schedule`, { method: 'POST', headers: { 'Idempotency-Key': makeId('schedule') } }); return this.load(); }, async returnMarketToDraft(id) { await request(`/admin/markets/${id}`, { method: 'PATCH', body: JSON.stringify({ status: 'DRAFT' }) }); return this.load(); }, async startMarket(id) { await request(`/admin/markets/${id}/start`, { method: 'POST', headers: { 'Idempotency-Key': makeId('start') } }); return this.load(); }, async closeMarket(id) { await request(`/admin/markets/${id}/close`, { method: 'POST', headers: { 'Idempotency-Key': makeId('close') } }); return this.load(); }, async settleMarket(id) { await request(`/admin/markets/${id}/settle`, { method: 'POST', headers: { 'Idempotency-Key': makeId('settle') } }); return this.load(); }, async archiveMarket(id) { await request(`/admin/markets/${id}/archive`, { method: 'POST', headers: { 'Idempotency-Key': makeId('archive') } }); return this.load(); }, async duplicateMarket() { throw createError('ADMIN_API_NOT_SUPPORTED', '종목 복제 API 계약은 백엔드와 확정 후 연결합니다.'); }, async moderateComment(id, payload) { await request(`/admin/comments/${id}/moderation`, { method: 'PATCH', body: JSON.stringify(payload), headers: { 'Idempotency-Key': makeId('comment') } }); return this.load(); }, async createStaffComment(input) { await request('/admin/comments', { method: 'POST', body: JSON.stringify(input) }); return this.load(); }, async adjustCredits(id, payload) { await request(`/admin/users/${id}/wallet-adjustments`, { method: 'POST', body: JSON.stringify(payload), headers: { 'Idempotency-Key': makeId('wallet') } }); return this.load(); }, async restrictUser(id, payload) { await request(`/admin/users/${id}/restrictions`, { method: 'PATCH', body: JSON.stringify(payload), headers: { 'Idempotency-Key': makeId('restriction') } }); return this.load(); },
  };

  const localAdapter = { load: async () => localLoad(), createMarket: async (input) => localCreateMarket(input), updateDraftMarket: async (id, input) => localUpdateDraftMarket(id, input), scheduleMarket: async (id) => localScheduleMarket(id), returnMarketToDraft: async (id) => localReturnMarketToDraft(id), startMarket: async (id) => localStartMarket(id), closeMarket: async (id) => localCloseMarket(id), settleMarket: async (id) => localSettleMarket(id), archiveMarket: async (id) => localArchiveMarket(id), duplicateMarket: async (id) => localDuplicateMarket(id), moderateComment: async (id, payload) => localModerateComment(id, payload), createStaffComment: async (input) => localCreateStaffComment(input), adjustCredits: async (id, payload) => localAdjustCredits(id, payload), restrictUser: async (id, payload) => localRestrictUser(id, payload) };
  function activeAdapter() { return ADMIN_API_ENABLED ? httpAdapter : localAdapter; }

  return Object.freeze({ MARKET_STATES, canTransitionMarket, validateMarketSchedule, validateMarketInput, localDateTime, getMode: () => ADMIN_API_ENABLED ? 'API' : 'LOCAL_DEMO', getOperator: () => clone(OPERATOR), load: () => activeAdapter().load(), createMarket: (input) => activeAdapter().createMarket(input), updateDraftMarket: (id, input) => activeAdapter().updateDraftMarket(id, input), scheduleMarket: (id) => activeAdapter().scheduleMarket(id), returnMarketToDraft: (id) => activeAdapter().returnMarketToDraft(id), startMarket: (id) => activeAdapter().startMarket(id), closeMarket: (id) => activeAdapter().closeMarket(id), settleMarket: (id) => activeAdapter().settleMarket(id), archiveMarket: (id) => activeAdapter().archiveMarket(id), duplicateMarket: (id) => activeAdapter().duplicateMarket(id), moderateComment: (id, payload) => activeAdapter().moderateComment(id, payload), createStaffComment: (input) => activeAdapter().createStaffComment(input), adjustCredits: (id, payload) => activeAdapter().adjustCredits(id, payload), restrictUser: (id, payload) => activeAdapter().restrictUser(id, payload), resetDemo: () => ADMIN_API_ENABLED ? Promise.reject(createError('ADMIN_API_MODE', 'API 연결 모드에서는 시연 데이터를 초기화할 수 없습니다.')) : Promise.resolve(localResetDemo()) });
})();
