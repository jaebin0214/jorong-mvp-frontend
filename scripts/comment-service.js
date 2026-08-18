// [댓글 서비스] 댓글·답글·HYPE를 서버에 저장하고, API 주소가 없을 때만 화면 시연용 로컬 목록으로 동작합니다.
(() => {
  const API_BASE_URL = (window.JORONG_API_BASE_URL || '').replace(/\/$/, '');
  const marketConfig = window.MarketConfig.get();
  const TARGET_ID = marketConfig.subject.id;
  // [로컬 댓글 저장소] 관리자 화면과 사용자 거래소가 같은 사이트 주소에서 댓글·답글·HYPE를 함께 읽습니다.
  const LOCAL_STORE_KEY = 'jorong-mvp-local-comments-v1';
  const LOCAL_VISITOR_KEY = 'jorong-mvp-local-comment-visitor';
  let localRoots = [];
  let localCommentSequence = 0;
  let localHypedCommentId = null;
  let localStore = null;
  let activeLocalSessionId = '';
  let localVisitorId = '';

  // [현재 세션 ID] 서버 시계의 현재 라운드 ID를 우선 사용해 투자·댓글·가격 차트가 한 시장을 가리키게 합니다.
  function getMarketSessionId() {
    return window.MarketCountdown?.getSessionId?.() || marketConfig.session.id;
  }

  function getAuthHeaders() {
    return window.AuthService?.getRequestHeaders?.() || {};
  }

  // [작성 가능 여부] 화면의 입력 잠금과 실제 저장 요청이 같은 시장 상태를 보도록 한 곳에서 판정합니다.
  // 서버 연결 뒤에도 API가 최종 검증하지만, 프런트에서는 존재하지 않거나 닫힌 장에 작성 UI를 열지 않습니다.
  function getCommentingState() {
    const config = window.MarketConfig?.get?.() || marketConfig;
    const countdown = window.MarketCountdown;
    // marketAvailable/status가 없던 이전 API 응답은 기존처럼 OPEN으로 해석해 호환성을 유지합니다.
    const status = String(countdown?.getStatus?.() || config.session?.status || 'OPEN').toUpperCase();

    if (config.marketAvailable === false) {
      return { isOpen: false, message: '현재 거래 중인 장이 없어 새 댓글을 작성할 수 없습니다.' };
    }
    if (countdown?.requiresServerClock?.() && !countdown.isReady?.()) {
      return { isOpen: false, message: '거래 시간을 확인 중입니다. 잠시 후 다시 시도해주세요.' };
    }
    if (countdown?.isEnded?.() || ['CLOSED', 'SETTLED', 'ARCHIVED'].includes(status)) {
      return { isOpen: false, message: '거래가 종료되어 새 댓글을 작성할 수 없습니다.' };
    }
    if (!['OPEN', 'LIVE'].includes(status)) {
      return { isOpen: false, message: '거래가 시작되면 새 댓글을 작성할 수 있습니다.' };
    }
    return { isOpen: true, message: '' };
  }

  function assertCommentingIsOpen() {
    const state = getCommentingState();
    if (!state.isOpen) throw new Error(state.message);
  }

  // [트리 탐색] 답글까지 포함한 ID 탐색/HYPE 집계를 하나의 재귀 함수로 처리합니다.
  function findComment(comments, id) {
    for (const comment of comments) {
      if (comment.id === id) return comment;
      const found = findComment(comment.replies || [], id);
      if (found) return found;
    }
    return null;
  }

  // 로그인 전 시연 참여자도 같은 익명 ID를 공유하지 않도록 탭 단위 식별자를 분리합니다.
  // 실제 운영에서는 항상 인증된 사용자 ID를 서버가 결정합니다.
  function getLocalVisitorId() {
    if (localVisitorId) return localVisitorId;
    try { localVisitorId = window.sessionStorage?.getItem(LOCAL_VISITOR_KEY) || ''; } catch (_) { /* no-op */ }
    if (!localVisitorId) {
      localVisitorId = `local-visitor-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      try { window.sessionStorage?.setItem(LOCAL_VISITOR_KEY, localVisitorId); } catch (_) { /* no-op */ }
    }
    return localVisitorId;
  }

  function getLocalAuthor() {
    const account = window.AuthService?.getCurrentAccount?.();
    return { id: account?.id || getLocalVisitorId(), nickname: account?.nickname || '나' };
  }

  function createCommentError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
  }

  function readLocalStore() {
    try {
      const stored = JSON.parse(window.localStorage.getItem(LOCAL_STORE_KEY) || 'null');
      return stored?.version === 1 && stored?.markets && typeof stored.markets === 'object' ? stored : { version: 1, markets: {} };
    } catch (_) {
      return { version: 1, markets: {} };
    }
  }

  function getLargestCommentSequence(comments) {
    let largest = 0;
    (comments || []).forEach((comment) => {
      const match = String(comment?.id || '').match(/^local-comment-(\d+)$/);
      if (match) largest = Math.max(largest, Number(match[1]));
      largest = Math.max(largest, getLargestCommentSequence(comment?.replies || []));
    });
    return largest;
  }

  // 회차별 댓글 트리와 사용자별 HYPE 선택을 하나의 로컬 레코드에 저장합니다.
  function syncLocalBucket({ reload = false } = {}) {
    const marketSessionId = getMarketSessionId();
    if (reload || !localStore || activeLocalSessionId !== marketSessionId) localStore = readLocalStore();
    if (!localStore.markets[marketSessionId]) {
      localStore.markets[marketSessionId] = { roots: [], sequence: 0, hypedCommentIdsByUser: {} };
    }
    const bucket = localStore.markets[marketSessionId];
    bucket.roots = Array.isArray(bucket.roots) ? bucket.roots : [];
    bucket.hypedCommentIdsByUser = bucket.hypedCommentIdsByUser && typeof bucket.hypedCommentIdsByUser === 'object' ? bucket.hypedCommentIdsByUser : {};
    localRoots = bucket.roots;
    localCommentSequence = Math.max(Number(bucket.sequence) || 0, getLargestCommentSequence(localRoots));
    localHypedCommentId = bucket.hypedCommentIdsByUser[getLocalAuthor().id] || null;
    activeLocalSessionId = marketSessionId;
    return bucket;
  }

  function markCurrentUserHype(comments) {
    (comments || []).forEach((comment) => {
      comment.isHypedByCurrentUser = comment.id === localHypedCommentId;
      markCurrentUserHype(comment.replies || []);
    });
  }

  function saveLocalBucket(bucket) {
    bucket.roots = localRoots;
    bucket.sequence = localCommentSequence;
    bucket.hypedCommentIdsByUser[getLocalAuthor().id] = localHypedCommentId || null;
    try { window.localStorage.setItem(LOCAL_STORE_KEY, JSON.stringify(localStore)); } catch (_) { /* no-op */ }
    // 같은 탭의 사이클 리포트도 최신 댓글 보관본을 갱신할 수 있게 알립니다.
    if (typeof window.dispatchEvent === 'function' && typeof CustomEvent === 'function') {
      window.dispatchEvent(new CustomEvent('jorong:comments-changed', { detail: { marketSessionId: getMarketSessionId() } }));
    }
  }

  // [HTTP 요청] 인증 쿠키/토큰을 포함해 현재 로그인 사용자의 작성 권한과 HYPE 선택 상태를 서버가 판별할 수 있게 합니다.
  async function request(path, options = {}) {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      credentials: 'include',
      ...options,
      headers: {
        Accept: 'application/json',
        ...getAuthHeaders(),
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(options.headers || {}),
      },
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.message || '댓글 요청을 처리하지 못했습니다.');
    return body;
  }

  // [목록 형태 통일] 서버는 중첩 replies와 currentUserHypedCommentId를 반환해야 하며, 화면은 여기서 동일한 구조만 사용합니다.
  function normalizeListResponse(payload = {}) {
    const comments = payload.comments || payload.data?.comments || [];
    return {
      comments: Array.isArray(comments) ? comments : [],
      currentUserHypedCommentId: payload.currentUserHypedCommentId || payload.myHypedCommentId || null,
      bestCommentId: payload.bestCommentId || payload.bestHypedComment?.id || null,
    };
  }

  // [댓글 목록 조회] 재접속·화면 첫 진입 시 DB에 저장된 댓글/답글/HYPE 집계와 내 HYPE 선택을 가져옵니다.
  async function loadComments() {
    if (!API_BASE_URL) {
      syncLocalBucket({ reload: true });
      markCurrentUserHype(localRoots);
      return {
        comments: localRoots,
        currentUserHypedCommentId: localHypedCommentId,
        bestCommentId: getBestLocalCommentId(),
      };
    }
    const params = new URLSearchParams({ targetId: TARGET_ID });
    const body = await request(`/markets/${encodeURIComponent(getMarketSessionId())}/comments?${params}`, { method: 'GET' });
    return normalizeListResponse(body);
  }

  function getBestLocalCommentId() {
    let best = null;
    function inspect(comments) {
      comments.forEach((comment) => {
        if (String(comment.status || 'PUBLIC').toUpperCase() !== 'DELETED' && (!best || Number(comment.hypeCount || 0) > Number(best.hypeCount || 0))) best = comment;
        inspect(comment.replies || []);
      });
    }
    inspect(localRoots);
    return Number(best?.hypeCount || 0) > 0 ? best.id : null;
  }

  // [로컬 작성] 시연 중에도 서버 응답과 같은 comment 구조를 반환해 UI와 API 연결 코드를 분리합니다.
  function createLocalComment({ targetId, parentCommentId = null, content, marketSessionId }) {
    assertCommentingIsOpen();
    const bucket = syncLocalBucket({ reload: true });
    if (marketSessionId && marketSessionId !== getMarketSessionId()) throw new Error('현재 거래 세션과 일치하지 않습니다.');
    if (targetId !== TARGET_ID) throw new Error('존재하지 않는 투자 항목입니다.');
    if (!String(content || '').trim()) throw new Error('댓글 내용을 입력해주세요.');

    const comment = {
      id: `local-comment-${++localCommentSequence}`,
      marketSessionId: getMarketSessionId(),
      targetId,
      parentCommentId,
      content: String(content).trim(),
      author: getLocalAuthor(),
      createdAt: new Date().toISOString(),
      status: 'PUBLIC',
      hypeCount: 0,
      isHypedByCurrentUser: false,
      replies: [],
    };
    if (parentCommentId) {
      const parent = findComment(localRoots, parentCommentId);
      if (!parent) throw new Error('답글을 달 원댓글을 찾지 못했습니다.');
      parent.replies.push(comment);
    } else {
      localRoots.unshift(comment);
    }
    saveLocalBucket(bucket);
    return { comment };
  }

  // [댓글·답글 저장] parentCommentId가 null이면 댓글, 값이 있으면 답글로 서버에 저장합니다.
  async function createComment(payload) {
    assertCommentingIsOpen();
    if (!API_BASE_URL) return createLocalComment(payload);
    return request('/comments', {
      method: 'POST',
      body: JSON.stringify({ ...payload, marketSessionId: getMarketSessionId() }),
    });
  }

  // [댓글 삭제] 본인이 쓴 정확한 댓글/답글만 소프트 삭제합니다.
  // 부모 댓글을 지워도 다른 사용자의 답글은 보존해야 하므로 트리에서 제거하지 않습니다.
  async function deleteComment(commentId) {
    if (!commentId) throw new Error('삭제할 댓글 정보가 없습니다.');
    if (!API_BASE_URL) {
      const bucket = syncLocalBucket({ reload: true });
      const comment = findComment(localRoots, commentId);
      if (!comment) throw createCommentError('COMMENT_NOT_FOUND', '삭제할 댓글을 찾을 수 없습니다.');
      if (String(comment.status || 'PUBLIC').toUpperCase() === 'DELETED') throw createCommentError('COMMENT_ALREADY_DELETED', '이미 삭제된 댓글입니다.');
      if (String(comment.author?.id || '') !== String(getLocalAuthor().id)) {
        throw createCommentError('COMMENT_DELETE_FORBIDDEN', '본인이 작성한 댓글만 삭제할 수 있습니다.');
      }
      comment.status = 'DELETED';
      comment.deletedAt = new Date().toISOString();
      comment.deletedBy = getLocalAuthor().id;
      Object.keys(bucket.hypedCommentIdsByUser).forEach((userId) => {
        if (bucket.hypedCommentIdsByUser[userId] === commentId) bucket.hypedCommentIdsByUser[userId] = null;
      });
      // 삭제된 댓글의 HYPE는 시장 집계에서 제외합니다.
      comment.hypeCount = 0;
      if (localHypedCommentId === commentId) localHypedCommentId = null;
      saveLocalBucket(bucket);
      return { deletedCommentId: commentId, comment };
    }
    return request(`/comments/${encodeURIComponent(commentId)}`, { method: 'DELETE' });
  }

  // [HYPE 저장] 한 사용자는 한 시장에서 하나의 댓글/답글만 HYPE할 수 있습니다. 서버의 UNIQUE 제약이 최종 판정합니다.
  async function hypeComment(commentId) {
    if (!commentId) throw new Error('HYPE할 댓글을 찾지 못했습니다.');
    if (!API_BASE_URL) {
      const bucket = syncLocalBucket({ reload: true });
      if (localHypedCommentId && localHypedCommentId !== commentId) throw new Error('이번 시장에서는 이미 다른 댓글에 HYPE를 보냈습니다.');
      if (!localHypedCommentId) {
        const comment = findComment(localRoots, commentId);
        if (!comment) throw new Error('HYPE할 댓글을 찾지 못했습니다.');
        if (String(comment.status || 'PUBLIC').toUpperCase() === 'DELETED') throw new Error('삭제된 댓글에는 HYPE를 보낼 수 없습니다.');
        localHypedCommentId = commentId;
        comment.hypeCount = Number(comment.hypeCount || 0) + 1;
        comment.isHypedByCurrentUser = true;
        saveLocalBucket(bucket);
      }
      return { selectedCommentId: localHypedCommentId, bestCommentId: getBestLocalCommentId() };
    }
    return request(`/comments/${encodeURIComponent(commentId)}/hype`, {
      method: 'POST',
      body: JSON.stringify({ marketSessionId: getMarketSessionId() }),
    });
  }

  // [리포트용 내 댓글] 정산 결과와 함께 해당 시장에서 내가 쓴 원댓글·답글을 읽습니다.
  // API 모드에서는 GET /me/cycle-reports 응답의 myComments를 사용하므로 여기서는 로컬 시연만 처리합니다.
  function getMyCommentsForMarket(marketSessionId) {
    if (API_BASE_URL) return [];
    const bucket = readLocalStore().markets?.[marketSessionId];
    const authorId = String(getLocalAuthor().id);
    const mine = [];
    function collect(comments) {
      (comments || []).forEach((comment) => {
        if (String(comment.author?.id || '') === authorId) {
          mine.push({
            id: String(comment.id),
            parentCommentId: comment.parentCommentId || null,
            content: String(comment.content || ''),
            status: String(comment.status || 'PUBLIC').toUpperCase(),
            createdAt: comment.createdAt || null,
            deletedAt: comment.deletedAt || null,
          });
        }
        collect(comment.replies || []);
      });
    }
    collect(bucket?.roots || []);
    return mine.sort((left, right) => Date.parse(left.createdAt || 0) - Date.parse(right.createdAt || 0));
  }

  window.CommentService = Object.freeze({
    TARGET_ID,
    MARKET_SESSION_ID: marketConfig.session.id,
    getMarketSessionId,
    getCommentingState,
    loadComments,
    createComment,
    deleteComment,
    hypeComment,
    getMyCommentsForMarket,
    getCurrentAuthorId: () => getLocalAuthor().id,
  });
})();
