// [댓글 서비스] Supabase가 설정되면 post_comment RPC + comments/comment_reactions 테이블로 동작합니다.
// 설정 전에는 기존과 동일하게 로컬 목록으로 시연합니다. 반환 형태는 기존과 동일하게 유지했습니다.
(() => {
  const marketConfig = window.MarketConfig.get();
  const TARGET_ID = marketConfig.subject.id;
  const localRoots = [];
  let localCommentSequence = 0;
  let localHypedCommentId = null;

  function getMarketSessionId() {
    return window.MarketCountdown?.getSessionId?.() || marketConfig.session.id;
  }

  function assertCommentingIsOpen() {
    if (window.MarketCountdown?.requiresServerClock?.() && !window.MarketCountdown.isReady()) {
      throw new Error('거래 시간을 확인 중입니다. 잠시 후 다시 시도해주세요.');
    }
    if (window.MarketCountdown?.isEnded()) throw new Error('거래가 종료되어 새 댓글을 작성할 수 없습니다.');
  }

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

  // ---- 아래부터 Supabase 연동 ----

  // comments 행을 화면이 기대하는 구조로 변환합니다.
  // ⚠️ `profiles(nickname)` 조인 문법은 Supabase가 comments.author_id → profiles.id FK를 자동 인식할 때만 동작합니다.
  //     콘솔에서 한 번 호출해보고 에러가 나면 `profiles!comments_author_id_fkey(nickname)`처럼 FK 이름을 명시해주세요.
  function mapRow(row, myUserId, myHypedId) {
    return {
      id: row.id,
      marketSessionId: getMarketSessionId(),
      targetId: TARGET_ID,
      parentCommentId: row.parent_id,
      content: row.body,
      author: {
        id: row.author_id,
        nickname: row.is_anonymous ? '익명' : (row.profiles?.nickname || '알 수 없음'),
      },
      createdAt: row.created_at,
      canDelete: row.author_id === myUserId,
      hypeCount: row.fun_count || 0,
      isHypedByCurrentUser: row.id === myHypedId,
      replies: [],
    };
  }

  function buildTree(rows, myUserId, myHypedId) {
    const byId = new Map();
    const roots = [];
    rows.forEach((row) => byId.set(row.id, mapRow(row, myUserId, myHypedId)));
    rows.forEach((row) => {
      const node = byId.get(row.id);
      if (row.parent_id && byId.has(row.parent_id)) {
        byId.get(row.parent_id).replies.push(node);
      } else if (!row.parent_id) {
        roots.push(node);
      }
    });
    return roots;
  }

  // [댓글 목록 조회] blinded/deleted 여부와 상관없이 status<>'deleted'만 가져오고, blinded는 화면에서
  // content를 가릴지 원본 텍스트를 보여줄지 comments-ui.js 쪽에서 status 필드로 분기해야 합니다(현재 안 넘기고 있음 — 필요시 mapRow에 status 추가).
  async function loadRemoteComments() {
    const stock = await window.getActiveStock();
    const { data: { user } } = await window.SupabaseClient.auth.getUser();

    const [{ data: rows, error }, reactionResult] = await Promise.all([
      window.SupabaseClient
        .from('comments')
        .select('*, profiles(nickname)')
        .eq('stock_id', stock.id)
        .neq('status', 'deleted')
        .order('created_at', { ascending: true }),
      user
        ? window.SupabaseClient.from('comment_reactions').select('comment_id').eq('user_id', user.id).eq('is_fun', true).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);
    if (error) throw new Error(error.message);

    const myHypedId = reactionResult?.data?.comment_id ?? null;
    const roots = buildTree(rows || [], user?.id, myHypedId);

    let bestCommentId = null;
    let bestCount = 0;
    (rows || []).forEach((row) => {
      if ((row.fun_count || 0) > bestCount) { bestCount = row.fun_count; bestCommentId = row.id; }
    });

    return { comments: roots, currentUserHypedCommentId: myHypedId, bestCommentId: bestCount > 0 ? bestCommentId : null };
  }

  async function loadComments() {
    if (!window.SupabaseClient) {
      return { comments: localRoots, currentUserHypedCommentId: localHypedCommentId, bestCommentId: getBestLocalCommentId() };
    }
    return loadRemoteComments();
  }

  async function createComment(payload) {
    assertCommentingIsOpen();
    if (!window.SupabaseClient) return createLocalComment(payload);

    const stock = await window.getActiveStock();
    const { data: commentId, error } = await window.SupabaseClient.rpc('post_comment', {
      stock_id: stock.id,
      body: payload.content,
      parent_id: payload.parentCommentId || null,
      is_anonymous: false,
    });
    if (error) throw new Error(error.message);

    const account = window.AuthService?.getCurrentAccount?.();
    return {
      comment: {
        id: commentId,
        marketSessionId: getMarketSessionId(),
        targetId: payload.targetId,
        parentCommentId: payload.parentCommentId || null,
        content: payload.content,
        author: { id: account?.id, nickname: account?.nickname },
        createdAt: new Date().toISOString(),
        canDelete: true,
        hypeCount: 0,
        isHypedByCurrentUser: false,
        replies: [],
      },
    };
  }

  // [댓글 삭제] 물리 삭제 대신 status='deleted'로 소프트 삭제합니다(DB 스키마 설계안 5절 원칙).
  // ⚠️ RLS가 본인 댓글에 한해 이 UPDATE를 허용하는지 실제로 한 번 확인해주세요.
  async function deleteComment(commentId) {
    if (!commentId) throw new Error('삭제할 댓글 정보가 없습니다.');
    if (!window.SupabaseClient) {
      removeComment(localRoots, commentId);
      if (localHypedCommentId === commentId) localHypedCommentId = null;
      return { deletedCommentId: commentId };
    }
    const { error } = await window.SupabaseClient
      .from('comments')
      .update({ status: 'deleted', deleted_at: new Date().toISOString() })
      .eq('id', commentId);
    if (error) throw new Error(error.message);
    return { deletedCommentId: commentId };
  }

  // [HYPE] comment_reactions.is_fun UPSERT입니다.
  // ⚠️ "한 시장당 HYPE 1개만" 규칙은 기존 로컬 코드에만 있던 프론트 규칙이고, DB 제약(UNIQUE)으로 강제되는지는
  //     확인 못했습니다. 여러 댓글에 중복 HYPE가 실제로 되는지 테스트해보고, 안 막힌다면 이 함수에서
  //     기존 HYPE를 먼저 취소하는 로직을 추가해야 합니다.
  async function hypeComment(commentId) {
    if (!commentId) throw new Error('HYPE할 댓글을 찾지 못했습니다.');
    if (!window.SupabaseClient) {
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

    const { data: { user } } = await window.SupabaseClient.auth.getUser();
    if (!user) throw new Error('로그인이 필요합니다.');
    const { error } = await window.SupabaseClient
      .from('comment_reactions')
      .upsert({ comment_id: commentId, user_id: user.id, is_fun: true });
    if (error) throw new Error(error.message);
    return { selectedCommentId: commentId };
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
