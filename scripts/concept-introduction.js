// [컨셉 소개 제어] 첫 방문 여부, 4장 슬라이드 렌더링, 다시 보기 동작을 담당합니다.
window.ConceptIntroduction = (() => {
  const storageKey = 'jorong-mvp-concept-introduction-complete';
  const sessionStorageKey = `${storageKey}:session`;
  const layer = document.querySelector('#concept-introduction');
  const art = document.querySelector('#concept-introduction-art');
  const title = document.querySelector('#concept-introduction-title');
  const description = document.querySelector('#concept-introduction-description');
  const next = document.querySelector('#concept-introduction-next');
  const progress = document.querySelector('#concept-introduction-progress');
  const replayButton = document.querySelector('#landing-concept-replay');
  let step = 0;

  // [안전장치] 소개 레이어가 없는 페이지에서도 다른 화면 기능이 멈추지 않도록 빈 기능을 반환합니다.
  if (!layer || !art || !title || !description || !next || !progress) {
    return { start: () => false, replay: () => false, complete: () => {} };
  }

  // [최초 방문 저장] Edge의 추적 방지·file:// 환경도 고려해 localStorage, sessionStorage, 쿠키를 함께 사용합니다.
  function getCookieValue(name) {
    const prefix = `${name}=`;
    const entry = document.cookie.split('; ').find((item) => item.startsWith(prefix));
    return entry ? entry.slice(prefix.length) : null;
  }

  function hasCompletedIntroduction() {
    try {
      if (window.localStorage.getItem(storageKey) === 'true') return true;
    } catch { /* 저장소가 차단된 환경에서는 쿠키를 확인합니다. */ }

    try {
      if (window.sessionStorage.getItem(sessionStorageKey) === 'true') return true;
    } catch { /* 같은 탭의 sessionStorage도 사용할 수 없으면 쿠키를 확인합니다. */ }

    return getCookieValue(storageKey) === 'true';
  }

  function persistIntroductionCompletion() {
    try { window.localStorage.setItem(storageKey, 'true'); } catch { /* no-op */ }
    try { window.sessionStorage.setItem(sessionStorageKey, 'true'); } catch { /* no-op */ }
    try { document.cookie = `${storageKey}=true; max-age=31536000; path=/; samesite=lax`; } catch { /* no-op */ }
  }

  // [진행점] 피그마처럼 설명 슬라이드 3장의 현재 위치만 작고 간결한 점으로 표시합니다.
  function renderProgress() {
    const showProgress = step < 3;
    progress.hidden = !showProgress;
    progress.innerHTML = showProgress
      ? Array.from({ length: 3 }, (_, index) => `<span class="${index === step ? 'is-active' : ''}" aria-hidden="true"></span>`).join('')
      : '';
  }

  // [렌더링] 현재 슬라이드의 시각 요소, 문구, 버튼 문구를 적용합니다.
  function render() {
    const slides = window.MVP_DATA.conceptIntroductionSlides;
    const slide = slides[step];

    // [모바일 전용 디자인 상태] 같은 데이터로 데스크톱·모바일의 서로 다른 Figma 배치를 적용합니다.
    layer.dataset.conceptStep = String(step);
    art.innerHTML = slide.art;
    title.textContent = slide.title;
    // [마지막 모바일 장] 타이머의 안내 문구와 시간을 분리해, 화면별로 각각의 크기를 조절할 수 있게 합니다.
    description.innerHTML = slide.final
      ? '<span class="concept-final-countdown"><small>거래 시작까지</small><strong>03:00:00</strong></span><span class="concept-final-caption">시작하면 오늘의 종목과 실시간 가격을 확인할 수 있어요.</span>'
      : '';
    if (!slide.final) description.textContent = slide.description;
    next.textContent = slide.buttonLabel || '다음';
    layer.classList.toggle('is-final', Boolean(slide.final));
    renderProgress();
  }

  // [완료] 소개를 닫고, 다음 방문부터는 다시 보지 않도록 완료 상태를 저장합니다.
  function complete() {
    persistIntroductionCompletion();
    layer.classList.remove('is-open');
    layer.setAttribute('aria-hidden', 'true');
  }

  // [시작] 완료 기록이 없는 첫 방문에만 열고, 다시 보기 버튼은 force 옵션으로 항상 열 수 있습니다.
  function open({ force = false } = {}) {
    // 로그인한 사용자는 자동으로 컨셉 소개를 다시 보지 않고, 랜딩의 다시 보기 버튼으로만 열 수 있습니다.
    if (!force && window.AuthService?.getCurrentAccount?.()) return false;
    if (!force && hasCompletedIntroduction()) return false;

    step = 0;
    render();
    layer.classList.add('is-open');
    layer.setAttribute('aria-hidden', 'false');
    return true;
  }

  // [다음 장] 데스크톱 버튼과 모바일 화면 터치가 같은 진행 함수를 사용합니다.
  function advance() {
    const slides = window.MVP_DATA.conceptIntroductionSlides;
    if (step === slides.length - 1) complete();
    else {
      step += 1;
      render();
    }
  }

  next.addEventListener('click', advance);
  // [모바일 터치 진행] 버튼을 보이지 않게 하더라도 화면의 어느 빈 영역을 터치해도
  // 첫 장부터 마지막 시작 화면까지 자연스럽게 넘어갈 수 있게 합니다.
  layer.addEventListener('click', (event) => {
    if (!window.matchMedia('(max-width: 767px)').matches) return;
    if (!layer.classList.contains('is-open')) return;
    // 링크·입력 요소가 이후 추가되어도 의도하지 않은 진행을 막습니다.
    if (event.target.closest('a, input, textarea, select')) return;
    advance();
  });

  replayButton?.addEventListener('click', () => open({ force: true }));
  // [접근성] 키보드 사용자는 Esc 키로 소개를 닫을 수 있습니다.
  window.addEventListener('keydown', (event) => {
    if (layer.classList.contains('is-open') && event.key === 'Escape') complete();
  });

  return { start: open, replay: () => open({ force: true }), complete };
})();
