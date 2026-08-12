// [댓글 서비스] 댓글·답글·HYPE를 서버에 저장하고, API 주소가 없을 때만 화면 시연용 로컬 목록으로 동작합니다.
(() => {
  const API_BASE_URL = (window.JORONG_API_BASE_URL || '').replace(/\/$/, '');
  const marketConfig = window.MarketConfig.get();
  const TARGET_ID = marketConfig.subject.id;
  const localRoots = [];
  let localCommentSequence = 0;
  let localHypedCommentId = null;

  // [현재 세션 ID] 서버 시계의 현재 라운드 ID를 우선 사용해 투자·댓글·가격 차트가 한 시장을 가리키게 합니다.
  function getMarketSessionId() {
    return window.MarketCountdown?.getSessionId?.() || marketConfig.session.id;
  }

  function getAuthHeaders() {
    return window.AuthService?.getRequestHeaders?.() || {};
  }

  function assertCommentingIsOpen() {
    if (window.MarketCountdown?.requiresServerClock?.() && !window.MarketCountdown.isReady()) {
      throw new Error('거래 시간을 확인 중입니다. 잠시 후 다시 시도해주세요.');
    }
    if (window.MarketCountdown?.isEnded()) throw new Error('거래가 종료되어 새 댓글을 작성할 수 없습니다.');
  }

  // [트리 탐색] 답글까지 포함한 ID 탐색/삭제/HYPE 집계를 하나의 재귀 함수로 처리합니다.
  function findComment(comments, id) {
    for (const comment of comments) {
      if (comment.id === id) return comment;
      const found = findComment(comment.replies || [], id);
      if (found) return found;
    }
    return null;
  }

  function removeComment(comments, id) {
    const index = comments.findIndex((comment) => comment.id === id);
    if (index >= 0) return comments.splice(index, 1)[0];
    for (const comment of comments) {
      const removed = removeComment(comment.replies || [], id);
      if (removed) return removed;
    }
    return null;
  }

  function getLocalAuthor() {
    const account = window.AuthService?.getCurrentAccount?.();
    return { id: account?.id || 'local-user', nickname: account?.nickname || '나' };
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
        if (!best || Number(comment.hypeCount || 0) > Number(best.hypeCount || 0)) best = comment;
        inspect(comment.replies || []);
      });
    }
    inspect(localRoots);
    return Number(best?.hypeCount || 0) > 0 ? best.id : null;
  }

  // [로컬 작성] 시연 중에도 서버 응답과 같은 comment 구조를 반환해 UI와 API 연결 코드를 분리합니다.
  function createLocalComment({ targetId, parentCommentId = null, content, marketSessionId }) {
    assertCommentingIsOpen();
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
      canDelete: true,
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

  // [댓글 삭제] 서버는 현재 사용자가 작성자인지 검사하고, 삭제 댓글과 답글을 soft delete 또는 함께 숨겨야 합니다.
  async function deleteComment(commentId) {
    if (!commentId) throw new Error('삭제할 댓글 정보가 없습니다.');
    if (!API_BASE_URL) {
      removeComment(localRoots, commentId);
      if (localHypedCommentId === commentId) localHypedCommentId = null;
      return { deletedCommentId: commentId };
    }
    return request(`/comments/${encodeURIComponent(commentId)}`, { method: 'DELETE' });
  }

  // [HYPE 저장] 한 사용자는 한 시장에서 하나의 댓글/답글만 HYPE할 수 있습니다. 서버의 UNIQUE 제약이 최종 판정합니다.
  async function hypeComment(commentId) {
    if (!commentId) throw new Error('HYPE할 댓글을 찾지 못했습니다.');
    if (!API_BASE_URL) {
      if (localHypedCommentId && localHypedCommentId !== commentId) throw new Error('이번 시장에서는 이미 다른 댓글에 HYPE를 보냈습니다.');
      if (!localHypedCommentId) {
        const comment = findComment(localRoots, commentId);
        if (!comment) throw new Error('HYPE할 댓글을 찾지 못했습니다.');
        localHypedCommentId = commentId;
        comment.hypeCount = Number(comment.hypeCount || 0) + 1;
        comment.isHypedByCurrentUser = true;
      }
      return { selectedCommentId: localHypedCommentId, bestCommentId: getBestLocalCommentId() };
    }
    return request(`/comments/${encodeURIComponent(commentId)}/hype`, {
      method: 'POST',
      body: JSON.stringify({ marketSessionId: getMarketSessionId() }),
    });
  }

  window.CommentService = Object.freeze({
    TARGET_ID,
    MARKET_SESSION_ID: marketConfig.session.id,
    getMarketSessionId,
    loadComments,
    createComment,
    deleteComment,
    hypeComment,
  });
})();
