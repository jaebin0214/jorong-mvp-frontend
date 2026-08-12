// [댓글 종료 UI] 거래가 끝난 뒤에는 기존 댓글을 읽을 수 있게 두고 작성 기능만 잠급니다.
(() => {
  const commentForm = document.querySelector('#exchange-comment-form');
  const commentInput = document.querySelector('#exchange-comment-text');

  // [작성 기능 잠금] 댓글 입력창과 답글 작성 폼을 비활성화하되, 답글 목록을 여는 버튼은 유지합니다.
  function closeCommenting() {
    if (!commentForm || commentForm.classList.contains('is-market-ended')) return;

    commentForm.classList.add('is-market-ended');
    if (commentInput) {
      commentInput.value = '';
      commentInput.placeholder = '거래가 종료되어 새 댓글을 작성할 수 없습니다.';
      commentInput.disabled = true;
    }
    commentForm.querySelector('button[type="submit"]')?.setAttribute('disabled', '');

    document.querySelectorAll('.exchange-reply-form').forEach((replyForm) => {
      replyForm.hidden = true;
    });
    document.querySelectorAll('.exchange-reply-toggle').forEach((replyToggle) => {
      replyToggle.textContent = '답글 보기';
    });
  }

  window.addEventListener('jorong:market-ended', closeCommenting);

  // 재접속 시 이미 종료된 회차라면 댓글 작성 영역도 즉시 종료 상태로 맞춥니다.
  if (window.MarketCountdown?.isEnded()) closeCommenting();

  window.CommentCloseUI = Object.freeze({ closeCommenting });
})();
