// [댓글 종료 UI] 거래가 끝난 뒤에는 기존 댓글을 읽을 수 있게 두고 작성 기능만 잠급니다.
(() => {
  const commentForm = document.querySelector('#exchange-comment-form');
  const commentInput = document.querySelector('#exchange-comment-text');
  const commentSubmitButton = commentForm?.querySelector('button[type="submit"]');
  const mobileComposeButton = document.querySelector('#mobile-community-compose');
  const originalPlaceholder = commentInput?.placeholder || '';
  const originalMobileLabel = mobileComposeButton?.textContent || '조롱 남기기';

  function getCommentingState() {
    return window.CommentService?.getCommentingState?.()
      || { isOpen: !window.MarketCountdown?.isEnded?.(), message: '거래가 종료되어 새 댓글을 작성할 수 없습니다.' };
  }

  // [작성 기능 동기화] 장이 없거나 시작 전·종료 후에는 새 댓글과 답글만 잠그고, 기존 댓글 탐색은 그대로 둡니다.
  function syncCommentingState() {
    if (!commentForm) return;
    const state = getCommentingState();
    const isClosed = !state.isOpen;

    commentForm.classList.toggle('is-market-ended', isClosed);
    if (commentInput) {
      if (isClosed) commentInput.value = '';
      commentInput.placeholder = isClosed ? state.message : originalPlaceholder;
      commentInput.disabled = isClosed;
    }
    if (commentSubmitButton) commentSubmitButton.disabled = isClosed;

    if (mobileComposeButton) {
      mobileComposeButton.disabled = isClosed;
      mobileComposeButton.textContent = isClosed ? '댓글 작성 불가' : originalMobileLabel;
      mobileComposeButton.title = isClosed ? state.message : '';
    }

    document.querySelectorAll('.exchange-reply-toggle').forEach((replyToggle) => {
      replyToggle.disabled = isClosed;
      if (isClosed) replyToggle.textContent = '답글 보기';
    });
    if (isClosed) {
      document.querySelectorAll('.exchange-reply-form').forEach((replyForm) => {
        replyForm.hidden = true;
      });
    }
  }

  // 기존 종료 이벤트에서 사용하던 공개 함수명은 유지합니다.
  function closeCommenting() {
    syncCommentingState();
  }

  window.addEventListener('jorong:market-ended', closeCommenting);
  window.addEventListener('jorong:market-clock-synced', syncCommentingState);
  window.addEventListener('jorong:market-config-updated', syncCommentingState);

  // 재접속 시 장이 없거나 이미 종료된 회차라면 즉시 작성 영역을 잠급니다.
  syncCommentingState();

  window.CommentCloseUI = Object.freeze({ closeCommenting, syncCommentingState });
})();
