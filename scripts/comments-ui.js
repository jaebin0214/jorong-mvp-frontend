// [댓글 UI] 서버에서 받은 댓글 트리를 화면에 그리며, 댓글·답글·HYPE의 변경은 항상 CommentService를 거쳐 저장합니다.
(() => {
  const form = document.querySelector('#exchange-comment-form');
  const input = document.querySelector('#exchange-comment-text');
  const commentList = document.querySelector('#exchange-comment-list');
  const emptyMessage = document.querySelector('#exchange-comment-empty');
  const countLabel = document.querySelector('#exchange-comment-count');
  const focusButton = document.querySelector('#exchange-comment-focus');
  const toast = document.querySelector('#toast');
  const service = window.CommentService;
  let commentCount = 0;
  let selectedHypeCommentId = null;
  let bestCommentId = null;
  let toastTimer;

  function showToast(message) {
    toast.textContent = message;
    toast.classList.add('is-visible');
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toast.classList.remove('is-visible'), 3000);
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
        if (!best || Number(comment.hypeCount || 0) > Number(best.hypeCount || 0)) best = comment;
        inspect(comment.replies || []);
      });
    }
    inspect(comments || []);
    return Number(best?.hypeCount || 0) > 0 ? best.id : null;
  }

  function findCurrentUserHype(comments) {
    for (const comment of comments || []) {
      if (comment.isHypedByCurrentUser) return comment.id;
      const replyMatch = findCurrentUserHype(comment.replies || []);
      if (replyMatch) return replyMatch;
    }
    return null;
  }

  function focusCommentComposer() {
    input.scrollIntoView({ behavior: 'smooth', block: 'center' });
    input.focus({ preventScroll: true });
  }

  function isCurrentUsersComment(comment) {
    if (comment.canDelete === true) return true;
    const account = window.AuthService?.getCurrentAccount?.();
    return Boolean(account?.id && getAuthor(comment).id === account.id);
  }

  // [HYPE 버튼] 이미 HYPE를 보낸 사용자는 다른 모든 버튼을 잠그며, 최종 허용/집계는 API가 반환한 데이터로 다시 그립니다.
  function createHypeButton(comment, card) {
    const button = document.createElement('button');
    const isSelected = selectedHypeCommentId === comment.id || comment.isHypedByCurrentUser === true;
    const isLocked = Boolean(selectedHypeCommentId && !isSelected);
    button.type = 'button';
    button.className = 'exchange-hype-button';
    button.textContent = 'HYPE';
    button.setAttribute('aria-label', '이 댓글에 HYPE 보내기');
    button.setAttribute('aria-pressed', String(isSelected));
    button.classList.toggle('is-selected', isSelected);
    if (isLocked) {
      button.disabled = true;
      button.classList.add('is-locked');
      button.setAttribute('aria-label', '이번 시장에서는 이미 다른 댓글에 HYPE를 보냈습니다.');
    }
    if (isSelected) card.classList.add('is-hyped');

    button.addEventListener('click', async () => {
      if (selectedHypeCommentId && selectedHypeCommentId !== comment.id) return;
      button.disabled = true;
      try {
        const result = await service.hypeComment(comment.id);
        selectedHypeCommentId = result.selectedCommentId || result.currentUserHypedCommentId || comment.id;
        bestCommentId = result.bestCommentId || result.bestHypedComment?.id || bestCommentId;
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
  function attachReplyArea(contentArea, parentComment, replyButton) {
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
      nickname.textContent = author.nickname;
      time.textContent = replyData.timeLabel || '방금 전';
      message.textContent = replyData.content || '';
      header.append(nickname, time);
      const bestBadge = createBestBadge(replyData);
      if (bestBadge) header.append(bestBadge);
      if (isCurrentUsersComment(replyData)) header.append(createDeleteButton(replyData.id));
      const hypeControl = document.createElement('div');
      hypeControl.className = 'exchange-reply-hype';
      hypeControl.append(createHypeButton(replyData, reply), createHypeCount(replyData));
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

    replyButton.addEventListener('click', () => {
      replyArea.hidden = false;
      replyButton.setAttribute('aria-expanded', 'true');
      if (!window.MarketCountdown?.isEnded()) replyInput.focus();
    });

    replyForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (window.MarketCountdown?.isEnded()) {
        showToast('거래가 종료되어 새 답글을 작성할 수 없습니다.');
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
    nickname.textContent = author.nickname;
    time.textContent = commentData.timeLabel || '방금 전';
    message.textContent = commentData.content || '';
    replyButton.type = 'button';
    replyButton.className = 'exchange-reply-toggle';
    replyButton.textContent = '답글 달기';
    replyButton.setAttribute('aria-expanded', 'false');
    reportLabel.textContent = '신고';

    header.append(nickname, time);
    const bestBadge = createBestBadge(commentData);
    if (bestBadge) header.append(bestBadge);
    if (isCurrentUsersComment(commentData)) header.append(createDeleteButton(commentData.id));
    footer.append(createHypeButton(commentData, comment), createHypeCount(commentData), replyButton, reportLabel);
    contentArea.append(header, message, footer);
    attachReplyArea(contentArea, commentData, replyButton);
    comment.append(avatar, contentArea);
    commentList.append(comment);
  }

  // [목록 새로고침] 저장 직후와 재접속 시 서버가 보유한 정확한 HYPE 수·삭제 상태·답글 트리를 기준으로 다시 렌더링합니다.
  async function refreshComments() {
    const result = await service.loadComments();
    const comments = result.comments || [];
    selectedHypeCommentId = result.currentUserHypedCommentId || findCurrentUserHype(comments) || null;
    bestCommentId = result.bestCommentId || findBestCommentId(comments);
    commentList.replaceChildren();
    comments.forEach(appendComment);
    updateCommentCount();
    if (window.MarketCountdown?.isEnded()) window.CommentCloseUI?.closeCommenting?.();
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (window.MarketCountdown?.isEnded()) {
      showToast('거래가 종료되어 새 댓글을 작성할 수 없습니다.');
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

  focusButton.addEventListener('click', () => {
    if (commentCount === 0) return focusCommentComposer();
    window.InvestmentUI.open(focusButton);
  });

  refreshComments().catch((error) => {
    updateCommentCount();
    showToast(error.message || '댓글을 불러오지 못했습니다.');
  });
  window.CommentUI = Object.freeze({ refreshComments });
})();
