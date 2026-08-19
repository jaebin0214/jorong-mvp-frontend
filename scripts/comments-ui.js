// [댓글 UI] 서버에서 받은 댓글 트리를 화면에 그리며, 댓글·답글·HYPE의 변경은 항상 CommentService를 거쳐 저장합니다.
(() => {
  const form = document.querySelector('#exchange-comment-form');
  const input = document.querySelector('#exchange-comment-text');
  const commentList = document.querySelector('#exchange-comment-list');
  const emptyMessage = document.querySelector('#exchange-comment-empty');
  const countLabel = document.querySelector('#exchange-comment-count');
  // [모바일 대표 댓글] 전체 목록을 중복 저장하지 않고, 렌더링한 카드 하나만 복제해 메인 화면에 압축 표시합니다.
  const mobilePreview = document.querySelector('#mobile-comment-preview');
  const mobilePreviewHint = document.querySelector('#mobile-comment-preview-hint');
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
  // [댓글 정렬] HYPE 상위 원댓글 2개만 목록 위에 고정하고, 나머지는 오래된 댓글부터 보여줍니다.
  // 답글은 부모 댓글 안에서 기존 작성·더보기 흐름을 유지합니다.
  let topHypeCommentIds = [];
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

  function getCreatedAtTime(comment) {
    const timestamp = Date.parse(comment?.createdAt || '');
    return Number.isFinite(timestamp) ? timestamp : 0;
  }

  // [원댓글 표시 순서] 저장소·RPC가 최신순으로 응답하더라도 화면에서는 같은 규칙으로 다시 정렬합니다.
  // 동률이면 먼저 작성된 댓글을 우선해 새로고침할 때마다 순서가 바뀌지 않게 합니다.
  function orderRootComments(comments) {
    const roots = Array.isArray(comments) ? [...comments] : [];
    const byOldest = (left, right) => (
      getCreatedAtTime(left) - getCreatedAtTime(right)
      || String(left.id || '').localeCompare(String(right.id || ''))
    );
    const topHype = roots
      .filter((comment) => !isDeletedComment(comment) && Number(comment.hypeCount || 0) > 0)
      .sort((left, right) => (
        Number(right.hypeCount || 0) - Number(left.hypeCount || 0)
        || byOldest(left, right)
      ))
      .slice(0, 2);
    const topHypeIds = topHype.map((comment) => comment.id);
    const topHypeIdSet = new Set(topHypeIds);

    return {
      comments: [...topHype, ...roots.filter((comment) => !topHypeIdSet.has(comment.id)).sort(byOldest)],
      topHypeIds,
    };
  }

  // [모바일 대표 선택] HYPE가 있으면 가장 많은 원댓글, 없으면 가장 최근 원댓글을 보여 줍니다.
  // 삭제 댓글은 대표 후보에서 제외해 사용자가 바로 읽을 수 있는 대화를 먼저 볼 수 있게 합니다.
  function getMobilePreviewComment(comments) {
    const roots = (Array.isArray(comments) ? comments : []).filter((comment) => !isDeletedComment(comment));
    if (!roots.length) return null;
    const hyped = roots
      .filter((comment) => Number(comment.hypeCount || 0) > 0)
      .sort((left, right) => (
        Number(right.hypeCount || 0) - Number(left.hypeCount || 0)
        || getCreatedAtTime(right) - getCreatedAtTime(left)
      ));
    if (hyped.length) return hyped[0];
    return [...roots].sort((left, right) => (
      getCreatedAtTime(right) - getCreatedAtTime(left)
      || String(right.id || '').localeCompare(String(left.id || ''))
    ))[0];
  }

  // [모바일 미리보기] 실제 카드의 디자인을 그대로 쓰되, HYPE·답글·삭제 버튼은 댓글 시트 안에서만 조작하도록 제거합니다.
  function renderMobilePreview(comments) {
    if (!(mobilePreview instanceof HTMLElement)) return;
    const previewComment = getMobilePreviewComment(comments);
    mobilePreview.replaceChildren();
    mobilePreview.hidden = !previewComment;
    if (mobilePreviewHint instanceof HTMLElement) mobilePreviewHint.hidden = !previewComment;
    if (!previewComment) return;

    const source = [...commentList.querySelectorAll('.exchange-comment')]
      .find((element) => element.dataset.commentId === String(previewComment.id));
    if (!(source instanceof HTMLElement)) return;
    const previewCard = source.cloneNode(true);
    previewCard.classList.add('is-mobile-comment-preview-card');
    previewCard.removeAttribute('data-comment-id');
    previewCard.querySelectorAll('button, em, .exchange-reply-area, .exchange-replies, .exchange-reply-more').forEach((element) => element.remove());
    mobilePreview.append(previewCard);
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
  // [HYPE 표현] 정산 기록에서는 같은 모양을 유지하되, 마감된 시장의 기록이므로 읽기 전용으로 표시합니다.
  function createHypeButton(comment, card, { readOnly = false } = {}) {
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

    if (readOnly) {
      button.disabled = true;
      button.classList.add('is-read-only');
      button.setAttribute('aria-label', '마감된 시장의 HYPE 기록입니다.');
      return button;
    }

    button.addEventListener('click', async () => {
      if (hypedCommentIds.has(comment.id)) return;
      button.disabled = true;
      try {
        const result = await service.hypeComment(comment.id);
        hypedCommentIds.add(comment.id);
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
    const rank = topHypeCommentIds.indexOf(comment.id);
    if (rank < 0) return null;
    const badge = document.createElement('span');
    badge.className = 'exchange-best-hype';
    badge.textContent = rank === 0 ? '베스트 HYPE' : 'HYPE TOP 2';
    return badge;
  }

  function createHypeCount(comment) {
    const count = document.createElement('span');
    count.className = 'exchange-hype-count';
    count.textContent = `HYPE ${Number(comment.hypeCount || 0)}`;
    return count;
  }

  // [답글 영역] 최초에는 최대 3개만 표시하고, ‘답글 더보기’를 누를 때마다 3개씩 추가로 표시합니다.
  function attachReplyArea(contentArea, parentComment, replyButton, { allowReply = true, readOnly = false } = {}) {
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
    // 정산 기록에는 답글 작성 폼을 추가하지 않고, 이미 작성된 답글과 더보기 동작만 표시합니다.
    if (allowReply) replyArea.append(replyForm);
    replyArea.append(replyList, moreButton);
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
      const isDeleted = isDeletedComment(replyData);
      nickname.textContent = isDeleted ? '삭제된 사용자' : author.nickname;
      time.textContent = replyData.timeLabel || '방금 전';
      message.textContent = isDeleted ? '삭제된 댓글입니다.' : (replyData.content || '');
      reply.classList.toggle('is-deleted', isDeleted);
      header.append(nickname, time);
      const bestBadge = createBestBadge(replyData);
      if (bestBadge) header.append(bestBadge);
      if (!readOnly && isCurrentUsersComment(replyData)) header.append(createDeleteButton(replyData.id));
      const hypeControl = document.createElement('div');
      hypeControl.className = 'exchange-reply-hype';
      if (!isDeleted) hypeControl.append(createHypeButton(replyData, reply, { readOnly }), createHypeCount(replyData));
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

  // [댓글 카드 공통 렌더러] 거래 중 목록과 정산 기록이 동일한 정렬·카드 디자인을 공유합니다.
  // readOnly=true이면 HYPE·답글 작성·삭제 같은 시장 조작 요소만 비활성화합니다.
  function appendComment(commentData, { targetList = commentList, readOnly = false } = {}) {
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
    comment.dataset.commentId = String(commentData.id || '');
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
    if (!readOnly && isCurrentUsersComment(commentData)) header.append(createDeleteButton(commentData.id));
    if (!isDeleted) {
      footer.append(createHypeButton(commentData, comment, { readOnly }), createHypeCount(commentData));
      // 마감 뒤에는 새 답글·신고와 같은 작성·처리 동작을 노출하지 않습니다.
      if (!readOnly) footer.append(replyButton, reportLabel);
    }
    contentArea.append(header, message);
    if (!isDeleted) contentArea.append(footer);
    // 삭제된 원댓글의 기존 답글은 보존하되 새 답글 작성 제어는 노출하지 않습니다.
    if (isDeleted && (commentData.replies || []).length) attachReplyArea(contentArea, commentData, null, { allowReply: false, readOnly });
    else if (!isDeleted) attachReplyArea(contentArea, commentData, readOnly ? null : replyButton, { allowReply: !readOnly, readOnly });
    comment.append(avatar, contentArea);
    targetList.append(comment);
    return comment;
  }

  // [목록 새로고침] 저장 직후와 재접속 시 서버가 보유한 정확한 HYPE 수·삭제 상태·답글 트리를 기준으로 다시 렌더링합니다.
  async function refreshComments() {
    const result = await service.loadComments();
    const comments = result.comments || [];
    const ordered = orderRootComments(comments);
    hypedCommentIds = Array.isArray(result.currentUserHypedCommentIds)
      ? new Set(result.currentUserHypedCommentIds)
      : collectCurrentUserHypeIds(comments);
    topHypeCommentIds = ordered.topHypeIds;
    hasCurrentUserRootComment = findCurrentUsersRootComment(comments);
    commentList.replaceChildren();
    ordered.comments.forEach(appendComment);
    updateCommentCount();
    renderMobilePreview(comments);
    // 계정별 댓글 작성 여부를 투자 UI에 전달해 다른 사용자의 댓글로 잠금이 풀리지 않게 합니다.
    window.InvestmentUI?.setCommentUnlockState?.(hasCurrentUserRootComment);
    window.CommentCloseUI?.syncCommentingState?.();
    return result;
  }

  // [정산 댓글 기록] 최신 서버/로컬 댓글을 다시 읽어, 시장 목록과 완전히 같은 순서·카드 형태로 읽기 전용 복제본을 만듭니다.
  // 답글은 최초 3개만 보이고 ‘답글 더보기’로 3개씩 추가되는 기존 규칙도 그대로 재사용합니다.
  async function renderReadOnlyHistory(targetList) {
    if (!(targetList instanceof HTMLElement)) return { count: 0 };
    const sourceComments = await refreshComments();
    const comments = sourceComments.comments || [];
    const ordered = orderRootComments(comments);
    hypedCommentIds = Array.isArray(sourceComments.currentUserHypedCommentIds)
      ? new Set(sourceComments.currentUserHypedCommentIds)
      : collectCurrentUserHypeIds(comments);
    topHypeCommentIds = ordered.topHypeIds;
    targetList.replaceChildren();
    ordered.comments.forEach((comment) => appendComment(comment, { targetList, readOnly: true }));
    return { count: targetList.querySelectorAll('.exchange-comment, .exchange-reply').length };
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
      // 모바일은 댓글 시트를 닫고 기존 투자 바텀시트 흐름으로 이어 줍니다.
      window.dispatchEvent(new CustomEvent('jorong:comment-created'));
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
  window.CommentUI = Object.freeze({ refreshComments, renderReadOnlyHistory });
  window.dispatchEvent(new CustomEvent('jorong:comment-ui-ready'));
})();
