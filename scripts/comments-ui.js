// [댓글 UI] 서버에서 받은 댓글 트리를 화면에 그리며, 댓글·답글·HYPE의 변경은 항상 CommentService를 거쳐 저장합니다.
(() => {
  const form = document.querySelector('#exchange-comment-form');
  const input = document.querySelector('#exchange-comment-text');
  const commentList = document.querySelector('#exchange-comment-list');
  const emptyMessage = document.querySelector('#exchange-comment-empty');
  const countLabel = document.querySelector('#exchange-comment-count');
  // [잠긴 투자 카드] 별도 조롱 작성 버튼 대신 카드 전체를 눌러 기존 동작을 실행합니다.
  const roastCta = document.querySelector('#exchange-roast-cta');
  const toast = document.querySelector('#toast');
  const service = window.CommentService;
  let commentCount = 0;
  // [투자 잠금 판단] 전체 댓글 수와 별개로 현재 로그인 사용자가 작성한 원댓글이 있는지 보관합니다.
  let hasCurrentUserRootComment = false;
  // 확정(2026-08-17): HYPE는 "라운드당 1회"가 아니라 "댓글당 1회"만 제한됩니다.
  // 그래서 선택한 댓글 하나가 아니라, 이번 라운드에 내가 HYPE한 모든 댓글 ID를 집합으로 관리합니다.
  let hypedCommentIds = new Set();
  let bestCommentId = null;
  let toastTimer;

  function showToast(message) {
    toast.textContent = message;
    toast.classList.add('is-visible');
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toast.classList.remove('is-visible'), 3000);
  }

  // [댓글 작성 상태] 서비스의 시장 상태 판정을 UI에서도 재사용해 입력 진입과 저장 결과가 어긋나지 않게 합니다.
  function getCommentingState() {
    return service.getCommentingState?.()
      || { isOpen: !window.MarketCountdown?.isEnded?.(), message: '거래가 종료되어 새 댓글을 작성할 수 없습니다.' };
  }

  function getAvatarText(nickname) {
    return String(nickname || '나').slice(0, 1);
  }

  function getAuthor(comment) {
    return comment.author || { id: null, nickname: comment.authorNickname || '익명' };
  }

  function updateCommentCount() {
    commentCount = commentList.querySelectorAll('.exchange-comment, .exchange-reply').length;
    countLabel.textContent = `댓글 ${commentCount}`;
    emptyMessage.hidden = commentCount > 0;
  }

  // [최고 HYPE 계산] 목록 응답에 bestCommentId가 없더라도 화면에서 가장 많은 HYPE의 댓글을 표시할 수 있게 보완합니다.
  function findBestCommentId(comments) {
    let best = null;
    function inspect(items) {
      items.forEach((comment) => {
        if (!isDeletedComment(comment) && (!best || Number(comment.hypeCount || 0) > Number(best.hypeCount || 0))) best = comment;
        inspect(comment.replies || []);
      });
    }
    inspect(comments || []);
    return Number(best?.hypeCount || 0) > 0 ? best.id : null;
  }

  // [내 HYPE 전부 수집] 서버 응답에 currentUserHypedCommentIds가 없는 경우(예: 구버전 캐시)를 대비해
  // 댓글 트리의 isHypedByCurrentUser 플래그로도 같은 집합을 계산할 수 있게 합니다.
  function collectCurrentUserHypeIds(comments) {
    const ids = new Set();
    function inspect(items) {
      (items || []).forEach((comment) => {
        if (comment.isHypedByCurrentUser) ids.add(comment.id);
        inspect(comment.replies || []);
      });
    }
    inspect(comments);
    return ids;
  }

  function focusCommentComposer() {
    input.scrollIntoView({ behavior: 'smooth', block: 'center' });
    input.focus({ preventScroll: true });
  }

  function isCurrentUsersComment(comment) {
    const account = window.AuthService?.getCurrentAccount?.();
    // 비로그인 시연 참여자는 CommentService가 만든 탭 단위 ID를 기준으로만 삭제 여부를 판별합니다.
    const currentAuthorId = account?.id || service.getCurrentAuthorId?.() || '';
    return String(comment.status || 'PUBLIC').toUpperCase() !== 'DELETED'
      && String(getAuthor(comment).id || '') === String(currentAuthorId);
  }

  function isDeletedComment(comment) {
    return String(comment?.status || 'PUBLIC').toUpperCase() === 'DELETED';
  }

  // 답글만 작성한 경우에는 첫 투자가 열리지 않으며, 삭제된 내 댓글도 투자 권한으로 계산하지 않습니다.
  function findCurrentUsersRootComment(comments) {
    const currentAuthorId = String(window.AuthService?.getCurrentAccount?.()?.id || service.getCurrentAuthorId?.() || '');
    return (comments || []).some((comment) => (
      !isDeletedComment(comment)
      && String(getAuthor(comment).id || '') === currentAuthorId
    ));
  }

  // [HYPE 버튼] 이 댓글에 이미 HYPE를 보냈으면 이 버튼만 잠급니다. 다른 댓글에는 라운드당 제한 없이 계속 HYPE할 수 있습니다.
  // (확정 2026-08-17: 라운드당 1회 제한 폐지, 댓글당 1회만 제한 — 최종 허용/집계는 서버가 반환한 데이터로 다시 그립니다.)
  function createHypeButton(comment, card) {
    const button = document.createElement('button');
    const isSelected = hypedCommentIds.has(comment.id) || comment.isHypedByCurrentUser === true;
    button.type = 'button';
    button.className = 'exchange-hype-button';
    button.textContent = 'HYPE';
    button.setAttribute('aria-label', '이 댓글에 HYPE 보내기');
    button.setAttribute('aria-pressed', String(isSelected));
    button.classList.toggle('is-selected', isSelected);
    if (isSelected) {
      button.disabled = true;
      button.setAttribute('aria-label', '이미 이 댓글에 HYPE를 보냈습니다.');
      card.classList.add('is-hyped');
    }

    button.addEventListener('click', async () => {
      if (hypedCommentIds.has(comment.id)) return;
      button.disabled = true;
      try {
        const result = await service.hypeComment(comment.id);
        hypedCommentIds.add(comment.id);
        bestCommentId = result.bestCommentId || bestCommentId;
        await refreshComments();
      } catch (error) {
        showToast(error.message || 'HYPE를 저장하지 못했습니다.');
        button.disabled = false;
      }
    });
    return button;
  }

  function createDeleteButton(commentId) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'exchange-comment-delete';
    button.textContent = '삭제';
    button.setAttribute('aria-label', '내 댓글 삭제');
    button.addEventListener('click', async () => {
      button.disabled = true;
      try {
        await service.deleteComment(commentId);
        await refreshComments();
        showToast('댓글을 삭제했습니다.');
      } catch (error) {
        showToast(error.message || '댓글을 삭제하지 못했습니다.');
        button.disabled = false;
      }
    });
    return button;
  }

  function createBestBadge(comment) {
    if (bestCommentId !== comment.id) return null;
    const badge = document.createElement('span');
    badge.className = 'exchange-best-hype';
    badge.textContent = '베스트 HYPE';
    return badge;
  }

  function createHypeCount(comment) {
    const count = document.createElement('span');
    count.className = 'exchange-hype-count';
    count.textContent = `HYPE ${Number(comment.hypeCount || 0)}`;
    return count;
  }

  // [답글 영역] 최초에는 최대 3개만 표시하고, ‘답글 더보기’를 누를 때마다 3개씩 추가로 표시합니다.
  function attachReplyArea(contentArea, parentComment, replyButton, { allowReply = true } = {}) {
    const replyArea = document.createElement('div');
    const replyForm = document.createElement('form');
    const replyInput = document.createElement('input');
    const submitButton = document.createElement('button');
    const replyList = document.createElement('div');
    const moreButton = document.createElement('button');
    let visibleReplyCount = 3;

    replyArea.className = 'exchange-reply-area';
    replyArea.hidden = !(parentComment.replies || []).length;
    replyForm.className = 'exchange-reply-form';
    replyInput.type = 'text';
    replyInput.maxLength = 160;
    replyInput.placeholder = '답글을 입력하세요.';
    replyInput.setAttribute('aria-label', '답글 내용');
    submitButton.type = 'submit';
    submitButton.textContent = '등록';
    replyList.className = 'exchange-reply-list';
    moreButton.type = 'button';
    moreButton.className = 'exchange-reply-more';
    replyForm.append(replyInput, submitButton);
    replyArea.append(replyForm, replyList, moreButton);
    contentArea.append(replyArea);
    replyForm.hidden = !allowReply;

    function updateReplyVisibility() {
      Array.from(replyList.children).forEach((reply, index) => { reply.hidden = index >= visibleReplyCount; });
      moreButton.hidden = replyList.children.length <= visibleReplyCount;
      moreButton.textContent = '답글 더보기';
    }

    function appendReply(replyData) {
      const reply = document.createElement('article');
      const avatar = document.createElement('i');
      const body = document.createElement('div');
      const header = document.createElement('header');
      const author = getAuthor(replyData);
      const nickname = document.createElement('b');
      const time = document.createElement('span');
      const message = document.createElement('p');

      reply.className = 'exchange-reply';
      avatar.className = 'exchange-reply-avatar';
      avatar.textContent = getAvatarText(author.nickname);
      const isDeleted = isDeletedComment(replyData);
      nickname.textContent = isDeleted ? '삭제된 사용자' : author.nickname;
      time.textContent = replyData.timeLabel || '방금 전';
      message.textContent = isDeleted ? '삭제된 댓글입니다.' : (replyData.content || '');
      reply.classList.toggle('is-deleted', isDeleted);
      header.append(nickname, time);
      const bestBadge = createBestBadge(replyData);
      if (bestBadge) header.append(bestBadge);
      if (isCurrentUsersComment(replyData)) header.append(createDeleteButton(replyData.id));
      const hypeControl = document.createElement('div');
      hypeControl.className = 'exchange-reply-hype';
      if (!isDeleted) hypeControl.append(createHypeButton(replyData, reply), createHypeCount(replyData));
      body.append(header, message);
      reply.append(avatar, body, hypeControl);
      replyList.append(reply);
    }

    (parentComment.replies || []).forEach(appendReply);
    updateReplyVisibility();

    moreButton.addEventListener('click', () => {
      visibleReplyCount += 3;
      updateReplyVisibility();
    });

    if (replyButton) {
      replyButton.addEventListener('click', () => {
        replyArea.hidden = false;
        replyButton.setAttribute('aria-expanded', 'true');
        const state = getCommentingState();
        if (!state.isOpen) {
          replyArea.hidden = true;
          showToast(state.message);
          return;
        }
        replyInput.focus();
      });
    }

    replyForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const state = getCommentingState();
      if (!allowReply || !state.isOpen) {
        showToast(state.message);
        return;
      }
      const content = replyInput.value.trim();
      if (!content) return replyInput.focus();
      submitButton.disabled = true;
      try {
        await service.createComment({
          targetId: service.TARGET_ID,
          marketSessionId: service.getMarketSessionId(),
          parentCommentId: parentComment.id,
          content,
        });
        replyInput.value = '';
        await refreshComments();
      } catch (error) {
        showToast(error.message || '답글을 등록하지 못했습니다.');
      } finally {
        submitButton.disabled = false;
      }
    });
  }

  function appendComment(commentData) {
    const comment = document.createElement('article');
    const avatar = document.createElement('i');
    const contentArea = document.createElement('div');
    const header = document.createElement('header');
    const author = getAuthor(commentData);
    const nickname = document.createElement('b');
    const time = document.createElement('span');
    const message = document.createElement('p');
    const footer = document.createElement('footer');
    const replyButton = document.createElement('button');
    const reportLabel = document.createElement('em');

    comment.className = 'exchange-comment';
    avatar.textContent = getAvatarText(author.nickname);
    const isDeleted = isDeletedComment(commentData);
    nickname.textContent = isDeleted ? '삭제된 사용자' : author.nickname;
    time.textContent = commentData.timeLabel || '방금 전';
    message.textContent = isDeleted ? '삭제된 댓글입니다.' : (commentData.content || '');
    comment.classList.toggle('is-deleted', isDeleted);
    replyButton.type = 'button';
    replyButton.className = 'exchange-reply-toggle';
    replyButton.textContent = '답글 달기';
    replyButton.setAttribute('aria-expanded', 'false');
    reportLabel.textContent = '신고';

    header.append(nickname, time);
    const bestBadge = createBestBadge(commentData);
    if (bestBadge) header.append(bestBadge);
    if (isCurrentUsersComment(commentData)) header.append(createDeleteButton(commentData.id));
    if (!isDeleted) footer.append(createHypeButton(commentData, comment), createHypeCount(commentData), replyButton, reportLabel);
    contentArea.append(header, message);
    if (!isDeleted) contentArea.append(footer);
    // 삭제된 원댓글의 기존 답글은 보존하되 새 답글 작성 제어는 노출하지 않습니다.
    if (isDeleted && (commentData.replies || []).length) attachReplyArea(contentArea, commentData, null, { allowReply: false });
    else if (!isDeleted) attachReplyArea(contentArea, commentData, replyButton);
    comment.append(avatar, contentArea);
    commentList.append(comment);
  }

  // [목록 새로고침] 저장 직후와 재접속 시 서버가 보유한 정확한 HYPE 수·삭제 상태·답글 트리를 기준으로 다시 렌더링합니다.
  async function refreshComments() {
    const result = await service.loadComments();
    const comments = result.comments || [];
    hypedCommentIds = Array.isArray(result.currentUserHypedCommentIds)
      ? new Set(result.currentUserHypedCommentIds)
      : collectCurrentUserHypeIds(comments);
    bestCommentId = result.bestCommentId || findBestCommentId(comments);
    hasCurrentUserRootComment = findCurrentUsersRootComment(comments);
    commentList.replaceChildren();
    comments.forEach(appendComment);
    updateCommentCount();
    // 계정별 댓글 작성 여부를 투자 UI에 전달해 다른 사용자의 댓글로 잠금이 풀리지 않게 합니다.
    window.InvestmentUI?.setCommentUnlockState?.(hasCurrentUserRootComment);
    window.CommentCloseUI?.syncCommentingState?.();
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const state = getCommentingState();
    if (!state.isOpen) {
      showToast(state.message);
      return;
    }
    const content = input.value.trim();
    if (!content) return focusCommentComposer();
    const submitButton = form.querySelector('button[type="submit"]');
    submitButton.disabled = true;
    try {
      await service.createComment({
        targetId: service.TARGET_ID,
        marketSessionId: service.getMarketSessionId(),
        parentCommentId: null,
        content,
      });
      input.value = '';
      await refreshComments();
      window.InvestmentUI.open();
    } catch (error) {
      showToast(error.message || '댓글을 등록하지 못했습니다.');
    } finally {
      submitButton.disabled = false;
    }
  });

  function activateRoastCta() {
    const state = getCommentingState();
    if (!state.isOpen) {
      showToast(state.message);
      return;
    }
    // 다른 사용자가 작성한 댓글이 있어도 현재 계정이 댓글을 쓰기 전에는 입력창으로 안내합니다.
    if (!hasCurrentUserRootComment) return focusCommentComposer();
    window.InvestmentUI.open(roastCta);
  }

  roastCta.addEventListener('click', activateRoastCta);
  roastCta.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    activateRoastCta();
  });

  refreshComments().catch((error) => {
    updateCommentCount();
    showToast(error.message || '댓글을 불러오지 못했습니다.');
  });
  // 계정을 바꾸면 다른 사용자의 삭제 버튼·HYPE 선택 상태를 즉시 다시 계산합니다.
  window.addEventListener('jorong:auth-session', () => refreshComments().catch(() => {}));
  window.CommentUI = Object.freeze({ refreshComments });
})();
