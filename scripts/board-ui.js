// [게시판 UI] 선택한 분류의 제목·설명·게시글 목록을 같은 표 디자인으로 렌더링합니다.
(() => {
  const categoryButtons = document.querySelectorAll('[data-board-category]');
  const title = document.querySelector('#board-title');
  const description = document.querySelector('#board-description');
  const postList = document.querySelector('#board-post-list');
  const pagination = document.querySelector('.board-pagination');
  const toast = document.querySelector('#toast');
  let toastTimer;

  if (!window.BoardData || !title || !description || !postList) return;

  // [문자 이스케이프] 추후 API 텍스트가 표에 안전하게 표시되도록 기본 문자를 변환합니다.
  function escapeHtml(value) {
    return String(value).replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;' }[character]));
  }

  function showToast(message) {
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add('is-visible');
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toast.classList.remove('is-visible'), 2400);
  }

  // [목록 렌더링] 현재 카테고리 데이터를 번호 내림차순 표 행으로 변환합니다.
  function render(categoryKey) {
    const category = window.BoardData[categoryKey] || window.BoardData.free;
    title.textContent = category.title;
    description.textContent = category.description;
    categoryButtons.forEach((button) => button.classList.toggle('is-active', button.dataset.boardCategory === categoryKey));
    pagination.hidden = category.posts.length === 0;
    postList.innerHTML = category.posts.length
      ? category.posts.map(([postTitle, author, createdAt, hype], index) => `
        <tr><td>${category.posts.length - index}</td><td><button type="button" data-board-post-title="${escapeHtml(postTitle)}">${escapeHtml(postTitle)}</button></td><td>${escapeHtml(author)}</td><td>${escapeHtml(createdAt)}</td><td>${Number(hype).toLocaleString('ko-KR')}</td></tr>
      `).join('')
      : '<tr class="board-empty-row"><td colspan="5">아직 작성된 게시글이 없습니다.</td></tr>';
  }

  categoryButtons.forEach((button) => {
    button.addEventListener('click', () => render(button.dataset.boardCategory));
  });

  // [게시글 선택] 상세 화면 구현 전에는 선택한 제목을 포함한 안내 메시지를 표시합니다.
  postList.addEventListener('click', (event) => {
    const postButton = event.target.closest('[data-board-post-title]');
    if (postButton) showToast(`“${postButton.dataset.boardPostTitle}” 상세 기능은 다음 단계에서 연결됩니다.`);
  });

  render('all');
})();
