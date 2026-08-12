// [튜토리얼 제어] 첫 방문 여부, 9장 슬라이드 렌더링, 진행점 클릭을 담당합니다.
window.Tutorial = (() => {
  const storageKey = 'jorong-mvp-tutorial-complete';
  const layer = document.querySelector('#tutorial');
  const art = document.querySelector('#tutorial-art');
  const title = document.querySelector('#tutorial-title');
  const description = document.querySelector('#tutorial-description');
  const next = document.querySelector('#tutorial-next');
  const skip = document.querySelector('#tutorial-skip');
  const replayButton = document.querySelector('#landing-tutorial-replay');
  let step = 0;

  // [최초 방문 저장] localStorage를 우선 사용하고, 사용할 수 없는 환경에서는 쿠키를 보조 저장소로 사용합니다.
  function getCookieValue(name) {
    const prefix = `${name}=`;
    const entry = document.cookie.split('; ').find((item) => item.startsWith(prefix));
    return entry ? entry.slice(prefix.length) : null;
  }

  function hasCompletedTutorial() {
    try {
      if (window.localStorage.getItem(storageKey) === 'true') return true;
    } catch { /* 저장소가 차단된 환경에서는 쿠키를 확인합니다. */ }

    return getCookieValue(storageKey) === 'true';
  }

  function persistTutorialCompletion() {
    try { window.localStorage.setItem(storageKey, 'true'); } catch { /* no-op */ }
    try { document.cookie = `${storageKey}=true; max-age=31536000; path=/; samesite=lax`; } catch { /* no-op */ }
  }

  // [렌더링] 현재 슬라이드의 이미지와 안내 문구, 다음 버튼의 문구를 적용합니다.
  function render() {
    const slide = window.MVP_DATA.tutorialSlides[step];
    const isLastSlide = step === window.MVP_DATA.tutorialSlides.length - 1;
    art.innerHTML = slide.art;
    title.textContent = slide.title;
    description.textContent = slide.description;
    next.innerHTML = isLastSlide ? '거래소 시작하기' : '다음';
  }

  // [저장소] 정적 파일로 열었을 때 저장소가 막혀도 화면을 닫을 수 있게 예외를 처리합니다.
  function complete() {
    persistTutorialCompletion();
    layer.classList.remove('is-open');
    layer.setAttribute('aria-hidden', 'true');
  }

  // [시작] 로컬 저장소에 완료 기록이 없다면 웹사이트의 가장 앞에 안내를 띄웁니다.
  function open({ force = false } = {}) {
    if (!force && hasCompletedTutorial()) return false;
    step = 0;
    render();
    layer.classList.add('is-open');
    layer.setAttribute('aria-hidden', 'false');
    return true;
  }

  next.addEventListener('click', () => { if (step === window.MVP_DATA.tutorialSlides.length - 1) complete(); else { step += 1; render(); } });
  skip.addEventListener('click', complete);
  replayButton?.addEventListener('click', () => open({ force: true }));
  // [키보드] 방향키 진행은 제거하고, 접근성을 위한 Esc 닫기만 유지합니다.
  window.addEventListener('keydown', (event) => { if (layer.classList.contains('is-open') && event.key === 'Escape') complete(); });
  return { start: open, replay: () => open({ force: true }), complete };
})();
