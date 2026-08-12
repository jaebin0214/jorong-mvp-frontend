// [게시판 데이터] 서버 연결 전 초기 상태는 모든 카테고리에 게시글이 없는 빈 목록입니다.
window.BoardData = Object.freeze({
  all: {
    title: '전체 게시글',
    description: '조롱 거래소의 모든 커뮤니티 글을 한 번에 확인하세요.',
    posts: [],
  },
  free: {
    title: '자유게시판',
    description: '거래와 이야기부터 가벼운 잡담까지 자유롭게 남겨보세요.',
    posts: [],
  },
  discussion: {
    title: '종목 토론',
    description: '오늘의 투자 종목과 가격 흐름에 대한 의견을 나눠보세요.',
    posts: [],
  },
  humor: {
    title: '유머 · 뿔',
    description: '오늘의 종목과 시장을 소재로 한 가벼운 유머를 모아보세요.',
    posts: [],
  },
  suggestion: {
    title: '건의사항',
    description: '조롱 거래소를 더 재미있게 만들 아이디어를 제안해주세요.',
    posts: [],
  },
});
