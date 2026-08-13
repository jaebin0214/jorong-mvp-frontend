// [맨 위로 이동 UI] 댓글창 왼쪽 바깥에 버튼을 고정하고, 충분히 아래로 스크롤했을 때만 표시합니다.
(() => {
  const button = document.querySelector('#scroll-top-button');
  const communityCard = document.querySelector('.exchange-community-card');
  const SHOW_AFTER_PX = 280;
  const VIEWPORT_GUTTER = 16;
  const CARD_GAP = 12;

  if (!button) return;

  // [댓글창 기준 위치] 화면 너비가 달라져도 댓글창의 왼쪽 바깥에 일정한 간격으로 배치합니다.
  function positionBesideCommunity() {
    if (!communityCard) return;

    const communityLeft = communityCard.getBoundingClientRect().left;
    const preferredLeft = communityLeft - button.offsetWidth - CARD_GAP;

    // [좁은 화면 보호] 버튼이 화면 밖으로 나가지 않도록 최소 여백은 유지합니다.
    button.style.left = `${Math.max(VIEWPORT_GUTTER, Math.round(preferredLeft))}px`;
  }

  function updateButton() {
    button.hidden = window.scrollY < SHOW_AFTER_PX;

    if (!button.hidden) {
      window.requestAnimationFrame(positionBesideCommunity);
    }
  }

  button.addEventListener('click', () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  window.addEventListener('scroll', updateButton, { passive: true });
  window.addEventListener('resize', positionBesideCommunity);
  window.addEventListener('jorong:view-changed', updateButton);
  updateButton();
})();
