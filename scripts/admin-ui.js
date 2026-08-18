// [관리자 UI] admin.html의 대시보드·종목·댓글·사용자·감사 기록을 AdminService를 통해 렌더링합니다.
(() => {
  const service = window.AdminService;
  if (!service) return;

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];
  const pageTitle = $('#admin-page-title');
  const pageDescription = $('#admin-page-description');
  const toast = $('#toast');
  const modal = $('#admin-modal');
  const modalTitle = $('#admin-modal-title');
  const modalEyebrow = $('#admin-modal-eyebrow');
  const modalContent = $('#admin-modal-content');
  const modalError = $('#admin-modal-error');
  const modalConfirm = $('#admin-modal-confirm');
  const modalCancel = $('#admin-modal-cancel');
  const modalClose = $('#admin-modal-close');
  const viewMeta = {
    dashboard: ['운영 대시보드', '현재 거래 상태와 다음 운영 일정을 확인합니다.'],
    markets: ['종목 관리 및 예약', '종목을 준비하고 예약 순서와 거래 상태를 관리합니다.'],
    comments: ['댓글 관리', '댓글을 검토하고 숨김 처리하며 운영진 댓글을 작성합니다.'],
    users: ['사용자 관리', '사용자 상태와 크레딧·댓글 제한 상태를 확인합니다.'],
    audit: ['운영 기록', '관리자 변경 이력과 처리 사유를 추적합니다.'],
  };
  const stateLabel = service.MARKET_STATES;
  let state = null;
  let activeView = 'dashboard';
  let marketStatusFilter = 'ALL';
  let editingMarketId = null;
  let modalHandler = null;
  let modalLastFocused = null;
  let toastTimer;
  let liveClockTimerId = null;
  let scheduleSyncTimerId = null;

  function escapeHtml(value) { return String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character])); }
  function formatKrw(value) { return `${Math.max(0, Math.round(Number(value) || 0)).toLocaleString('ko-KR')} KRW`; }
  function formatNumber(value) { return Math.max(0, Math.round(Number(value) || 0)).toLocaleString('ko-KR'); }
  function formatDateTime(value) { const date = new Date(value); return Number.isFinite(date.getTime()) ? `${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}` : '-'; }
  function toLocalInput(value) { return service.localDateTime(value); }
  function showToast(message) { toast.textContent = message; toast.classList.add('is-visible'); window.clearTimeout(toastTimer); toastTimer = window.setTimeout(() => toast.classList.remove('is-visible'), 3000); }
  function getMarket(marketId) { return state?.markets?.find((market) => market.id === marketId); }
  function getLiveMarket() { return state?.markets?.find((market) => market.status === 'LIVE') || null; }
  function statusClass(status) { return `is-${String(status || '').toLowerCase()}`; }
  function statusBadge(status) { return `<span class="admin-status ${statusClass(status)}">${escapeHtml(stateLabel[status] || status)}</span>`; }
  function commentStatusLabel(status) { return { PUBLIC: '공개', HIDDEN: '숨김', FLAGGED: '신고', BANNED: '금칙어', DELETED: '삭제' }[status] || status; }
  function commentStatusBadge(status) { return `<span class="admin-status ${statusClass(status)}">${commentStatusLabel(status)}</span>`; }

  // [공통 종료 시각] 로컬 관리자 LIVE 종목의 endAt은 거래소 MarketConfig로 그대로 전달됩니다.
  // 따라서 양쪽 화면이 같은 브라우저 시각으로 계산하면 초 단위까지 같은 시간이 표시됩니다.
  function getLiveClock(live) {
    const endAt = Date.parse(live?.endAt || '');
    if (!Number.isFinite(endAt)) return { label: '거래 시간을 확인 중입니다.', text: '--:--:--' };
    let targetAt = endAt;
    let label = '거래 종료까지';
    if (Date.now() >= endAt) {
      const next = state?.markets
        ?.filter((market) => market.status === 'SCHEDULED' && Date.parse(market.startAt || '') > endAt)
        .sort((left, right) => Date.parse(left.startAt) - Date.parse(right.startAt))[0];
      targetAt = Date.parse(next?.startAt || '') || (endAt + (24 * 60 * 60 * 1000));
      label = '다음 장 시작까지';
    }
    const totalSeconds = Math.max(0, Math.ceil((targetAt - Date.now()) / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return { label, text: [hours, minutes, seconds].map((value) => String(value).padStart(2, '0')).join(':') };
  }

  function renderLiveCountdown() {
    const label = $('#admin-live-countdown-label');
    const value = $('#admin-live-countdown');
    if (!label || !value) return;
    const clock = getLiveClock(getLiveMarket());
    label.textContent = clock.label;
    value.textContent = clock.text;
    value.classList.toggle('is-next-market', clock.label === '다음 장 시작까지');
  }

  function getMarketStateSignature(value) {
    return (value?.markets || []).map((market) => `${market.id}:${market.status}:${market.updatedAt}`).join('|');
  }

  // 로컬 예약 자동 시작은 관리자 탭이 열린 동안만 시연합니다. 변경될 때만 화면을 다시 그립니다.
  async function syncLocalMarketSchedule() {
    if (service.getMode() !== 'LOCAL_DEMO' || !state) return;
    const nextState = await service.load();
    if (getMarketStateSignature(nextState) === getMarketStateSignature(state)) return;
    state = nextState;
    renderAll();
  }

  // [뷰 전환] 사이드 메뉴 버튼과 각 섹션의 숨김 상태를 함께 동기화합니다.
  function showView(viewId) {
    activeView = viewMeta[viewId] ? viewId : 'dashboard';
    $$('.admin-view').forEach((view) => { view.hidden = view.id !== `admin-${activeView}`; });
    $$('[data-admin-view]').forEach((button) => button.classList.toggle('is-active', button.dataset.adminView === activeView));
    [pageTitle.textContent, pageDescription.textContent] = viewMeta[activeView];
    if (activeView === 'markets') renderMarkets();
    if (activeView === 'comments') renderComments();
    if (activeView === 'users') renderUsers();
    if (activeView === 'audit') renderAudit();
    window.scrollTo({ top: 0, behavior: 'auto' });
  }

  function renderDashboard() {
    const live = getLiveMarket();
    const liveBody = $('#admin-live-body');
    const closeButton = $('#admin-close-live');
    const clock = getLiveClock(live);
    $('#admin-live-status').textContent = live ? '● 현재 거래 중' : '● 거래 중인 종목 없음';
    $('#admin-live-round').textContent = live ? `오늘 ${live.sequence}번째 종목` : '예약을 확인해주세요';
    closeButton.disabled = !live;
    liveBody.innerHTML = live ? `<div class="admin-market-thumb">${live.imagePath ? `<img src="${escapeHtml(live.imagePath)}" alt="${escapeHtml(live.subjectName)} 종목 이미지" />` : ''}</div><div class="admin-live-copy"><h2>오늘의 종목 #${live.sequence} · ${escapeHtml(live.subjectName)}</h2><p>${escapeHtml(live.shortIntroduction)}</p><div class="admin-timer-box"><span id="admin-live-countdown-label">${clock.label}</span><strong id="admin-live-countdown">${clock.text}</strong></div>${service.getMode() === 'LOCAL_DEMO' ? '<p class="admin-local-bridge-note">로컬 거래소 연동 준비됨 · 같은 브라우저와 같은 사이트 주소에서 거래소를 열면 이 LIVE 종목이 자동 반영됩니다.</p>' : ''}</div>` : '<div class="admin-empty">현재 거래 중인 종목이 없습니다. 종목 관리에서 예약을 확인해주세요.</div>';
    renderLiveCountdown();
    const scheduled = state.markets.filter((market) => market.status === 'SCHEDULED').sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt)).slice(0, 2);
    $('#admin-next-schedules').innerHTML = scheduled.length ? scheduled.map((market) => `<div class="admin-schedule-row"><div><strong>${formatDateTime(market.startAt)}</strong><span>종목 #${market.sequence} · ${escapeHtml(market.subjectName)}</span></div><em>예약 완료</em></div>`).join('') : '<div class="admin-empty">다음 예약 종목이 없습니다.</div>';
    const comments = state.comments || [];
    const needsReview = comments.filter((comment) => ['FLAGGED', 'BANNED'].includes(comment.status)).length;
    const isApiMode = service.getMode() === 'API';
    const liveMetricDetail = isApiMode ? '실시간 집계' : '실시간 집계 데이터 연동 전';
    const metrics = live ? [{ label: '현재 참여자', value: `${formatNumber(live.participantCount)}명`, detail: liveMetricDetail }, { label: '누적 거래', value: `${formatNumber(live.tradeCount)}건`, detail: liveMetricDetail }, { label: '작성 댓글', value: `${formatNumber(live.commentCount)}개`, detail: '댓글 공개 상태' }, { label: '검토 필요 댓글', value: `${formatNumber(needsReview)}개`, detail: needsReview ? '신고·금칙어 확인 필요' : '검토 항목 없음', tone: needsReview ? 'is-warning' : '' }] : [{ label: '예약 종목', value: `${scheduled.length}개`, detail: '다음 운영 일정' }, { label: '등록 종목', value: `${state.markets.length}개`, detail: '보관 기록 포함' }, { label: '작성 댓글', value: `${comments.length}개`, detail: '운영진 댓글 포함' }, { label: '검토 필요 댓글', value: `${needsReview}개`, detail: '댓글 검토로 이동', tone: needsReview ? 'is-warning' : '' }];
    $('#admin-dashboard-metrics').innerHTML = metrics.map((metric) => `<article class="admin-metric"><header>${metric.label}<i></i></header><strong>${metric.value}</strong><span class="${metric.tone || ''}">${metric.detail}</span></article>`).join('');
    const participationTrend = state.participationTrend || [];
    $('#admin-participation-trend').innerHTML = participationTrend.length ? participationTrend.map((value, index) => `<div class="admin-trend-item"><i style="height:${Math.max(12, value)}%"></i><span>${10 + index}:00</span></div>`).join('') : '<div class="admin-empty">집계된 참여 추이가 없습니다.</div>';
    $('#admin-participation-caption').textContent = isApiMode ? '시간대별 참여 집계는 아직 연동 전입니다.' : '현재 회차 기준 로컬 시연 데이터입니다.';
    const checklist = [{ done: Boolean(live), text: live ? '현재 거래 중 종목이 정상 상태입니다.' : '거래 중 종목을 시작해야 합니다.' }, { done: scheduled.length > 0, text: scheduled.length ? '다음 예약 종목과 시간을 확인했습니다.' : '다음 종목 예약이 필요합니다.' }, { done: needsReview === 0, text: needsReview ? `검토가 필요한 댓글 ${needsReview}개가 있습니다.` : '검토가 필요한 댓글이 없습니다.' }, { done: true, text: isApiMode ? '관리자 API 연결 모드입니다.' : '로컬 시연 모드임을 확인했습니다.' }];
    $('#admin-checklist').innerHTML = checklist.map((item) => `<li class="${item.done ? '' : 'is-pending'}"><i>${item.done ? '✓' : '!'}</i>${item.text}</li>`).join('');
  }

  function renderMarketFilters() {
    const filters = ['ALL', 'LIVE', 'SCHEDULED', 'DRAFT', 'CLOSED', 'SETTLED', 'ARCHIVED'];
    $('#admin-market-status-filters').innerHTML = filters.map((filter) => { const count = filter === 'ALL' ? state.markets.length : state.markets.filter((market) => market.status === filter).length; const label = filter === 'ALL' ? '전체' : stateLabel[filter]; return `<button class="${marketStatusFilter === filter ? 'is-active' : ''}" type="button" data-market-filter="${filter}">${label} ${count}</button>`; }).join('');
  }

  function marketActionButtons(market) {
    const buttons = ['<button type="button" data-market-action="preview" data-market-id="' + market.id + '">미리보기</button>', '<button type="button" data-market-action="duplicate" data-market-id="' + market.id + '">복제</button>'];
    if (market.status === 'DRAFT') buttons.unshift(`<button type="button" data-market-action="edit" data-market-id="${market.id}">편집</button>`, `<button type="button" data-market-action="schedule" data-market-id="${market.id}">예약</button>`);
    if (market.status === 'SCHEDULED') buttons.unshift(`<button type="button" data-market-action="draft" data-market-id="${market.id}">예약 취소</button>`, `<button type="button" data-market-action="start" data-market-id="${market.id}">거래 시작</button>`);
    if (market.status === 'LIVE') buttons.unshift(`<button class="is-danger" type="button" data-market-action="close" data-market-id="${market.id}">거래 종료</button>`);
    if (market.status === 'CLOSED') buttons.unshift(`<button type="button" data-market-action="settle" data-market-id="${market.id}">정산 처리</button>`);
    if (market.status === 'SETTLED') buttons.unshift(`<button type="button" data-market-action="archive" data-market-id="${market.id}">보관</button>`);
    return buttons.join('');
  }

  function renderMarkets() {
    renderMarketFilters();
    const dateFilter = $('#admin-market-date-filter').value;
    const markets = state.markets.filter((market) => (marketStatusFilter === 'ALL' || market.status === marketStatusFilter) && (!dateFilter || market.operationDate === dateFilter)).sort((a, b) => a.sequence - b.sequence);
    $('#admin-market-result-count').textContent = `${markets.length}개 표시`;
    $('#admin-market-table').innerHTML = markets.length ? markets.map((market) => `<tr><td>${market.sequence}</td><td><strong>${escapeHtml(market.subjectName)}</strong><small>${escapeHtml(market.shortIntroduction)}</small></td><td>${statusBadge(market.status)}</td><td>${formatDateTime(market.startAt)} ~ ${formatDateTime(market.endAt)}</td><td>${formatKrw(market.basePrice)}</td><td>${market.imagePath ? '이미지 등록' : '이미지 미등록'}<small>${market.commentsPublic ? '댓글 공개' : '댓글 비공개'}</small></td><td><div class="admin-table-actions">${marketActionButtons(market)}</div></td></tr>`).join('') : '<tr><td colspan="7"><div class="admin-empty">조건에 맞는 종목이 없습니다.</div></td></tr>';
  }

  function setMarketImagePreview(imagePath, label = '') {
    const image = $('#admin-market-image-preview');
    image.src = imagePath || '';
    image.classList.toggle('is-visible', Boolean(imagePath));
    $('#admin-market-image-name').textContent = label || (imagePath ? '현재 등록된 이미지' : '이미지를 등록해주세요.');
  }

  function populateMarketEditor(market = null) {
    editingMarketId = market?.id || null;
    $('#admin-market-editor').hidden = false;
    $('#admin-market-editor-title').textContent = market ? `${market.sequence}번 종목 편집` : '새 종목 등록';
    $('#admin-market-id').value = market?.id || '';
    $('#admin-market-name').value = market?.subjectName || '';
    $('#admin-market-short').value = market?.shortIntroduction || '';
    $('#admin-market-description').value = market?.description || '';
    $('#admin-market-date').value = market?.operationDate || '';
    $('#admin-market-start').value = market ? toLocalInput(market.startAt) : '';
    $('#admin-market-end').value = market ? toLocalInput(market.endAt) : '';
    $('#admin-market-price').value = market?.basePrice || 1000;
    $('#admin-market-min-unit').value = market?.minTradeUnit || 10;
    $('#admin-market-settlement').value = market?.settlementMethod || '자동 정산';
    $('#admin-market-image').value = market?.imagePath || '';
    $('#admin-market-auto-start').checked = market?.autoStart ?? true;
    $('#admin-market-auto-settle').checked = market?.autoSettle ?? true;
    $('#admin-market-comments-public').checked = market?.commentsPublic ?? true;
    $('#admin-market-form-message').textContent = '';
    setMarketImagePreview(market?.imagePath || '');
    renderMarketFormPreview();
    $('#admin-market-name').focus({ preventScroll: true });
  }

  function closeMarketEditor() { $('#admin-market-editor').hidden = true; editingMarketId = null; }
  function readMarketForm() { return { subjectName: $('#admin-market-name').value, shortIntroduction: $('#admin-market-short').value, description: $('#admin-market-description').value, imagePath: $('#admin-market-image').value, operationDate: $('#admin-market-date').value, startAt: $('#admin-market-start').value, endAt: $('#admin-market-end').value, basePrice: $('#admin-market-price').value, minTradeUnit: $('#admin-market-min-unit').value, settlementMethod: $('#admin-market-settlement').value, autoStart: $('#admin-market-auto-start').checked, autoSettle: $('#admin-market-auto-settle').checked, commentsPublic: $('#admin-market-comments-public').checked }; }
  function renderMarketFormPreview() { const form = readMarketForm(); $('#admin-market-preview').innerHTML = `<strong>등록 전 확인 목록</strong><p><b>${escapeHtml(form.subjectName || '종목명 미입력')}</b> · ${escapeHtml(form.operationDate || '운영 날짜 미입력')} · ${escapeHtml(form.startAt || '시작 시각 미입력')} ~ ${escapeHtml(form.endAt || '종료 시각 미입력')}</p><p>기준 가격 ${escapeHtml(form.basePrice || '0')} KRW · ${form.autoStart ? '예약 시간 자동 시작' : '수동 시작'} · ${form.autoSettle ? '자동 정산' : '수동 정산'}</p>`; }

  async function saveMarket(mode) {
    try {
      const data = readMarketForm();
      service.validateMarketInput(data);
      let next;
      if (editingMarketId) next = await service.updateDraftMarket(editingMarketId, data);
      else { next = await service.createMarket(data); editingMarketId = next.markets[next.markets.length - 1].id; }
      state = next;
      if (mode === 'schedule') state = await service.scheduleMarket(editingMarketId);
      showToast(mode === 'schedule' ? '종목을 예약했습니다.' : '종목 초안을 저장했습니다.');
      closeMarketEditor(); renderAll();
    } catch (error) { $('#admin-market-form-message').textContent = error.message; }
  }

  function renderCommentMarketSelects() {
    const selectedFilter = $('#admin-comment-market-filter').value || 'ALL';
    const selectedStaffMarket = $('#admin-staff-market').value || '';
    const options = state.markets.filter((market) => market.status !== 'ARCHIVED').sort((a, b) => a.sequence - b.sequence).map((market) => `<option value="${market.id}">${market.sequence}번 · ${escapeHtml(market.subjectName)}</option>`).join('');
    $('#admin-comment-market-filter').innerHTML = `<option value="ALL">전체 종목</option>${options}`;
    $('#admin-staff-market').innerHTML = options;
    $('#admin-comment-market-filter').value = selectedFilter;
    $('#admin-staff-market').value = selectedStaffMarket || getLiveMarket()?.id || $('#admin-staff-market').value;
  }

  function renderComments() {
    renderCommentMarketSelects();
    const search = $('#admin-comment-search').value.trim().toLowerCase();
    const marketId = $('#admin-comment-market-filter').value || 'ALL';
    const status = $('#admin-comment-status-filter').value || 'ALL';
    const comments = state.comments.filter((comment) => { const searchable = `${comment.authorName} ${comment.content}`.toLowerCase(); return (!search || searchable.includes(search)) && (marketId === 'ALL' || comment.marketId === marketId) && (status === 'ALL' || comment.status === status); });
    $('#admin-comment-result-count').textContent = `${comments.length}개 표시`;
    $('#admin-comment-list').innerHTML = comments.length ? comments.map((comment) => { const market = getMarket(comment.marketId); const actionable = comment.status !== 'DELETED'; return `<article class="admin-comment-item ${comment.status !== 'PUBLIC' ? 'is-muted' : ''}"><div><div class="admin-comment-meta"><strong>${escapeHtml(comment.authorName)}</strong>${comment.authorType === 'ADMIN' ? '<span class="admin-admin-badge">운영진</span>' : ''}${comment.isNotice ? '<span class="admin-small-badge">공지</span>' : ''}${comment.pinned ? '<span class="admin-small-badge">상단 고정</span>' : ''}${commentStatusBadge(comment.status)}<span>${market ? `${market.sequence}번 · ${escapeHtml(market.subjectName)}` : '알 수 없는 종목'}</span><span>${formatDateTime(comment.createdAt)}</span></div><p class="admin-comment-content">${escapeHtml(comment.content)}</p><p class="admin-comment-extra">${comment.authorType === 'ADMIN' ? `실제 처리 관리자: ${escapeHtml(comment.operatorName || '-')}` : `신고 ${comment.reportCount || 0}건`}${comment.moderatedBy ? ` · 처리: ${escapeHtml(comment.moderatedBy)}` : ''}</p></div><div class="admin-table-actions"><button type="button" data-comment-action="detail" data-comment-id="${comment.id}">상세</button>${actionable ? `<button type="button" data-comment-action="moderate" data-comment-id="${comment.id}">처리</button>` : ''}</div></article>`; }).join('') : '<div class="admin-empty">조건에 맞는 댓글이 없습니다.</div>';
  }

  function renderUsers() {
    const search = $('#admin-user-search').value.trim().toLowerCase();
    const status = $('#admin-user-status-filter').value || 'ALL';
    const users = state.users.filter((user) => (!search || `${user.id} ${user.nickname}`.toLowerCase().includes(search)) && (status === 'ALL' || user.status === status));
    const totalCredits = state.users.reduce((sum, user) => sum + Number(user.credits || 0), 0);
    const restricted = state.users.filter((user) => user.commentRestricted).length;
    $('#admin-user-metrics').innerHTML = [{ label: '전체 사용자', value: `${state.users.length}명`, detail: service.getMode() === 'API' ? '전체 가입자' : '로컬 시연 계정' }, { label: '총 보유 크레딧', value: formatKrw(totalCredits), detail: '사용자별 잔액 합계' }, { label: '댓글 작성 제한', value: `${restricted}명`, detail: restricted ? '제한 상태 확인 필요' : '제한 사용자 없음', tone: restricted ? 'is-warning' : '' }, { label: '활성 사용자', value: `${state.users.filter((user) => user.status === 'ACTIVE').length}명`, detail: '정상 계정' }].map((metric) => `<article class="admin-metric"><header>${metric.label}<i></i></header><strong>${metric.value}</strong><span class="${metric.tone || ''}">${metric.detail}</span></article>`).join('');
    $('#admin-user-table').innerHTML = users.length ? users.map((user) => `<tr><td><strong>${escapeHtml(user.id)}</strong></td><td>${escapeHtml(user.nickname)}</td><td>${formatKrw(user.credits)}</td><td>${formatNumber(user.tradeCount)}회</td><td>${formatNumber(user.commentCount)}개</td><td>${user.status === 'ACTIVE' ? '<span class="admin-status is-live">정상</span>' : '<span class="admin-status is-flagged">이용 제한</span>'}</td><td>${user.commentRestricted ? '<span class="admin-status is-hidden">제한 중</span>' : '<span class="admin-status is-scheduled">가능</span>'}</td><td><div class="admin-table-actions"><button type="button" data-user-action="comments" data-user-id="${user.id}">작성 댓글</button><button type="button" data-user-action="adjust" data-user-id="${user.id}">크레딧 조정</button><button type="button" data-user-action="restrict" data-user-id="${user.id}">${user.commentRestricted ? '제한 해제' : '댓글 제한'}</button></div></td></tr>`).join('') : '<tr><td colspan="8"><div class="admin-empty">조건에 맞는 사용자가 없습니다.</div></td></tr>';
    $('#admin-user-list-caption').textContent = service.getMode() === 'API' ? '계정 제한·크레딧 변경은 관리자 API로 즉시 반영됩니다.' : '실제 계정 제한과 크레딧 변경은 추후 관리자 API가 최종 처리합니다.';
  }

  function renderAudit() {
    const search = $('#admin-audit-search').value.trim().toLowerCase();
    const category = $('#admin-audit-type-filter').value || 'ALL';
    const logs = state.auditLogs.filter((log) => { const searchable = `${log.action} ${log.target} ${log.detail} ${log.operator}`.toLowerCase(); return (!search || searchable.includes(search)) && (category === 'ALL' || log.category === category); });
    $('#admin-audit-caption').textContent = service.getMode() === 'API' ? '관리자 API로 처리된 실제 작업 이력입니다.' : '로컬 시연 모드의 작업 이력입니다.';
    $('#admin-audit-result-count').textContent = `${logs.length}건 표시`;
    $('#admin-audit-table').innerHTML = logs.length ? logs.map((log) => `<tr><td>${formatDateTime(log.createdAt)}</td><td>${escapeHtml(log.category)}</td><td><strong>${escapeHtml(log.action)}</strong></td><td>${escapeHtml(log.target)}</td><td>${escapeHtml(log.operator)}</td><td>${escapeHtml(log.detail)}</td></tr>`).join('') : '<tr><td colspan="6"><div class="admin-empty">아직 기록된 운영 작업이 없습니다.</div></td></tr>';
  }

  function renderAll() { renderDashboard(); renderMarkets(); renderComments(); renderUsers(); renderAudit(); showView(activeView); }

  // [확인 모달] 위험 작업은 공통 모달에서 사유를 확인하고, ESC·포커스 트랩을 지원합니다.
  function openModal({ eyebrow = '확인 필요', title, content, confirmLabel = '확인', danger = false, onConfirm }) {
    modalLastFocused = document.activeElement;
    modalEyebrow.textContent = eyebrow; modalTitle.textContent = title; modalContent.innerHTML = content; modalError.textContent = '';
    modalConfirm.textContent = confirmLabel; modalConfirm.className = danger ? 'admin-primary admin-modal-danger' : 'admin-primary'; modalHandler = onConfirm;
    modal.hidden = false; modal.setAttribute('aria-hidden', 'false'); document.body.style.overflow = 'hidden';
    const initial = modalContent.querySelector('input, select, textarea') || modalConfirm; initial.focus({ preventScroll: true });
  }
  function closeModal() { modal.hidden = true; modal.setAttribute('aria-hidden', 'true'); modalHandler = null; document.body.style.overflow = ''; modalLastFocused?.focus?.({ preventScroll: true }); }
  async function confirmModal() { if (!modalHandler) return; modalConfirm.disabled = true; modalError.textContent = ''; try { await modalHandler(); closeModal(); } catch (error) { modalError.textContent = error.message || '작업을 처리하지 못했습니다.'; } finally { modalConfirm.disabled = false; } }
  function trapModalFocus(event) { if (event.key === 'Escape' && !modal.hidden) { event.preventDefault(); closeModal(); return; } if (event.key !== 'Tab' || modal.hidden) return; const focusable = [...modal.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])')]; if (!focusable.length) return; const first = focusable[0]; const last = focusable[focusable.length - 1]; if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); } }

  async function applyService(method, ...args) { state = await service[method](...args); renderAll(); }
  function openMarketPreview(market) { openModal({ eyebrow: '사용자 화면 미리보기', title: `${market.sequence}번 · ${market.subjectName}`, content: `<div class="admin-live-body"><div class="admin-market-thumb">${market.imagePath ? `<img src="${escapeHtml(market.imagePath)}" alt="" />` : ''}</div><div class="admin-live-copy"><h2>${escapeHtml(market.subjectName)}</h2><p>${escapeHtml(market.shortIntroduction)}</p><p>기준 가격 ${formatKrw(market.basePrice)} · ${formatDateTime(market.startAt)} 시작</p></div></div><p>실제 사용자 화면은 종목이 거래 중 상태가 된 뒤 서버의 현재 시장 데이터를 기준으로 표시됩니다.</p>`, confirmLabel: '확인', onConfirm: async () => {} }); }
  function openCloseMarketModal(market) { openModal({ eyebrow: '거래 종료 확인', title: `${market.subjectName} 거래를 종료할까요?`, content: `<p><strong>현재 종목: ${escapeHtml(market.subjectName)}</strong></p><p>종료 후 신규 주문과 새 댓글 작성이 잠깁니다.</p><p>자동 정산: <strong>${market.autoSettle ? '사용 · 종료 직후 정산 완료 처리' : '사용 안 함 · 정산 대기 상태 유지'}</strong></p>`, confirmLabel: '거래 종료 확인', danger: true, onConfirm: async () => { await applyService('closeMarket', market.id); showToast('거래를 종료했습니다.'); } }); }
  function openCommentModal(comment) { const market = getMarket(comment.marketId); openModal({ eyebrow: '댓글 처리', title: '댓글 처리 방식을 선택해주세요.', content: `<p><strong>${escapeHtml(comment.authorName)}</strong> · ${escapeHtml(market?.subjectName || '종목')}</p><p>“${escapeHtml(comment.content)}”</p><label>처리 방식<select id="admin-modal-comment-action"><option value="HIDE">숨김 처리</option><option value="DELETE">소프트 삭제</option>${comment.status === 'HIDDEN' ? '<option value="UNHIDE">숨김 해제</option>' : ''}</select></label><label>처리 사유<textarea id="admin-modal-reason" rows="3" required placeholder="처리 사유를 입력해주세요"></textarea></label><p>삭제된 댓글도 운영 기록에는 보존됩니다.</p>`, confirmLabel: '처리 확인', danger: true, onConfirm: async () => { const action = $('#admin-modal-comment-action').value; const reason = $('#admin-modal-reason').value; await applyService('moderateComment', comment.id, { action, reason }); showToast('댓글 처리 결과를 저장했습니다.'); } }); }
  function openCreditModal(user) { openModal({ eyebrow: '크레딧 조정', title: `${user.nickname}님의 크레딧 조정`, content: `<p>현재 크레딧 <strong>${formatKrw(user.credits)}</strong></p><label>조정 값 (KRW)<input id="admin-modal-credit-amount" type="number" step="1" placeholder="예: 1000 또는 -1000" /></label><label>처리 사유<textarea id="admin-modal-reason" rows="3" required placeholder="사유를 입력해주세요"></textarea></label><p id="admin-credit-preview">조정 후 예상 크레딧: ${formatKrw(user.credits)}</p>`, confirmLabel: '조정 적용', onConfirm: async () => { await applyService('adjustCredits', user.id, { amount: $('#admin-modal-credit-amount').value, reason: $('#admin-modal-reason').value }); showToast('크레딧 조정을 기록했습니다.'); } }); $('#admin-modal-credit-amount').addEventListener('input', (event) => { const next = Math.max(0, Number(user.credits) + Math.round(Number(event.target.value) || 0)); $('#admin-credit-preview').textContent = `조정 후 예상 크레딧: ${formatKrw(next)}`; }); }
  function openRestrictionModal(user) { const nextRestricted = !user.commentRestricted; openModal({ eyebrow: '사용자 댓글 작성 제한', title: `${user.nickname}님의 댓글 작성${nextRestricted ? '을 제한' : ' 제한을 해제'}할까요?`, content: `<p>현재 상태: <strong>${user.commentRestricted ? '댓글 작성 제한 중' : '정상'}</strong></p><label>처리 사유<textarea id="admin-modal-reason" rows="3" required placeholder="사유를 입력해주세요"></textarea></label><p>실제 이용 제한은 서버 권한과 정책 검증이 필요합니다.</p>`, confirmLabel: nextRestricted ? '댓글 제한 적용' : '제한 해제', danger: nextRestricted, onConfirm: async () => { await applyService('restrictUser', user.id, { restricted: nextRestricted, reason: $('#admin-modal-reason').value }); showToast(nextRestricted ? '댓글 작성 제한을 적용했습니다.' : '댓글 작성 제한을 해제했습니다.'); } }); }

  function downloadCsv(filename, columns, rows) { const escapeCsv = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`; const content = `\uFEFF${[columns, ...rows].map((row) => row.map(escapeCsv).join(',')).join('\n')}`; const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' })); const link = document.createElement('a'); link.href = url; link.download = filename; link.click(); URL.revokeObjectURL(url); }

  // [이벤트] 버튼의 데이터 속성만으로 대상 ID와 처리 종류를 전달해 UI와 서비스 책임을 분리합니다.
  $$('[data-admin-view]').forEach((button) => button.addEventListener('click', () => showView(button.dataset.adminView)));
  $('#admin-close-live').addEventListener('click', () => { const live = getLiveMarket(); if (live) openCloseMarketModal(live); });
  $('#admin-reset-demo').addEventListener('click', () => openModal({ eyebrow: '로컬 관리자 데이터', title: '관리자 데이터를 초기화할까요?', content: '<p>운영자 페이지에서 등록한 종목, 운영진 댓글, 운영 기록을 비우고 빈 운영 상태로 되돌립니다. 사용자용 회원가입·투자·댓글 데이터에는 영향을 주지 않습니다.</p>', confirmLabel: '초기화', danger: true, onConfirm: async () => { state = await service.resetDemo(); closeMarketEditor(); $('#admin-staff-composer').hidden = true; renderAll(); showToast('관리자 로컬 데이터를 초기화했습니다.'); } }));
  $('#admin-market-status-filters').addEventListener('click', (event) => { const button = event.target.closest('[data-market-filter]'); if (!button) return; marketStatusFilter = button.dataset.marketFilter; renderMarkets(); });
  $('#admin-market-date-filter').addEventListener('change', renderMarkets);
  $('#admin-create-market').addEventListener('click', () => populateMarketEditor());
  $('#admin-close-market-editor').addEventListener('click', closeMarketEditor);
  $('#admin-open-user-preview').addEventListener('click', () => { window.open('./index.html', 'jorong-user-preview'); showToast('사용자 화면을 새 창에서 열었습니다.'); });
  $('#admin-market-image-file').addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const input = event.currentTarget;
    input.disabled = true;
    $('#admin-market-image-name').textContent = service.getMode() === 'API' ? '이미지를 업로드하고 있습니다.' : '이미지를 불러오고 있습니다.';
    try {
      // [이미지 저장] 로컬은 Data URL 미리보기, API 모드는 서버가 Storage에 저장한 URL을 받습니다.
      const result = await service.uploadMarketImage(file);
      const imagePath = String(result?.imagePath || '');
      if (!imagePath) throw new Error('이미지 URL을 받지 못했습니다.');
      $('#admin-market-image').value = imagePath;
      setMarketImagePreview(imagePath, service.getMode() === 'API' ? `${file.name} · 업로드 완료` : file.name);
      renderMarketFormPreview();
    } catch (error) {
      $('#admin-market-image-name').textContent = error.message || '이미지 업로드에 실패했습니다.';
      showToast(error.message || '이미지 업로드에 실패했습니다.');
    } finally {
      input.disabled = false;
    }
  });
  $('#admin-market-form').addEventListener('input', renderMarketFormPreview);
  $('#admin-market-preview-button').addEventListener('click', () => { const pseudo = { id: 'preview', sequence: '미리보기', ...readMarketForm() }; openMarketPreview(pseudo); });
  $('#admin-market-draft-button').addEventListener('click', () => saveMarket('draft'));
  $('#admin-market-form').addEventListener('submit', (event) => { event.preventDefault(); saveMarket('schedule'); });
  $('#admin-market-table').addEventListener('click', async (event) => { const button = event.target.closest('[data-market-action]'); if (!button) return; const market = getMarket(button.dataset.marketId); if (!market) return; try { const action = button.dataset.marketAction; if (action === 'edit') return populateMarketEditor(market); if (action === 'preview') return openMarketPreview(market); if (action === 'close') return openCloseMarketModal(market); if (action === 'schedule') { await applyService('scheduleMarket', market.id); showToast('종목을 예약했습니다.'); } if (action === 'draft') { await applyService('returnMarketToDraft', market.id); showToast('예약을 취소하고 초안으로 되돌렸습니다.'); } if (action === 'duplicate') { await applyService('duplicateMarket', market.id); showToast('종목을 초안으로 복제했습니다.'); } if (action === 'settle') { await applyService('settleMarket', market.id); showToast('정산 완료로 처리했습니다.'); } if (action === 'archive') { await applyService('archiveMarket', market.id); showToast('종목을 보관했습니다.'); } if (action === 'start') openModal({ eyebrow: '거래 시작 확인', title: `${market.subjectName} 거래를 시작할까요?`, content: '<p>거래 중인 종목은 한 번에 하나만 존재할 수 있습니다. 실제 운영 시작 판정은 서버가 담당합니다.</p>', confirmLabel: '거래 시작', onConfirm: async () => { await applyService('startMarket', market.id); showToast(service.getMode() === 'API' ? '거래를 시작했습니다.' : '로컬 시연에서 거래를 시작했습니다.'); } }); } catch (error) { showToast(error.message); } });
  $('#admin-comment-search').addEventListener('input', renderComments); $('#admin-comment-market-filter').addEventListener('change', renderComments); $('#admin-comment-status-filter').addEventListener('change', renderComments);
  $('#admin-open-staff-comment').addEventListener('click', () => { $('#admin-staff-composer').hidden = false; $('#admin-staff-comment-content').focus({ preventScroll: true }); }); $('#admin-close-staff-comment').addEventListener('click', () => { $('#admin-staff-composer').hidden = true; }); $('#admin-cancel-staff-comment').addEventListener('click', () => { $('#admin-staff-composer').hidden = true; });
  $('#admin-staff-comment-form').addEventListener('submit', async (event) => { event.preventDefault(); const form = event.currentTarget; try { await applyService('createStaffComment', { marketId: $('#admin-staff-market').value, content: $('#admin-staff-comment-content').value, isNotice: $('#admin-staff-notice').checked, pinned: $('#admin-staff-pinned').checked, immediatePublished: $('#admin-staff-publish').checked }); form.reset(); $('#admin-staff-publish').checked = true; $('#admin-staff-composer').hidden = true; showToast('운영진 댓글을 등록했습니다.'); } catch (error) { showToast(error.message); } });
  $('#admin-comment-list').addEventListener('click', (event) => { const button = event.target.closest('[data-comment-action]'); if (!button) return; const comment = state.comments.find((item) => item.id === button.dataset.commentId); if (!comment) return; if (button.dataset.commentAction === 'moderate') openCommentModal(comment); else openModal({ eyebrow: '댓글 상세', title: `${comment.authorName}님의 댓글`, content: `<p>${escapeHtml(comment.content)}</p><p>상태: ${commentStatusLabel(comment.status)} · 작성: ${formatDateTime(comment.createdAt)}</p><p>${comment.moderationReason ? `처리 사유: ${escapeHtml(comment.moderationReason)}` : '운영 처리 이력이 없습니다.'}</p>`, confirmLabel: '확인', onConfirm: async () => {} }); });
  $('#admin-user-search').addEventListener('input', renderUsers); $('#admin-user-status-filter').addEventListener('change', renderUsers);
  $('#admin-user-table').addEventListener('click', (event) => { const button = event.target.closest('[data-user-action]'); if (!button) return; const user = state.users.find((item) => item.id === button.dataset.userId); if (!user) return; if (button.dataset.userAction === 'adjust') return openCreditModal(user); if (button.dataset.userAction === 'restrict') return openRestrictionModal(user); const comments = state.comments.filter((comment) => comment.authorId === user.id); openModal({ eyebrow: '사용자 상세', title: `${user.nickname}님의 작성 댓글`, content: comments.length ? comments.map((comment) => `<p><strong>${escapeHtml(getMarket(comment.marketId)?.subjectName || '종목')}</strong> · ${commentStatusLabel(comment.status)}<br />${escapeHtml(comment.content)}</p>`).join('') : '<p>로컬 시연 데이터에 작성 댓글이 없습니다.</p>', confirmLabel: '확인', onConfirm: async () => {} }); });
  $('#admin-export-users').addEventListener('click', () => { downloadCsv('jorong-admin-users.csv', ['사용자 ID', '닉네임', '크레딧', '참여 거래', '작성 댓글', '상태', '댓글 제한'], state.users.map((user) => [user.id, user.nickname, user.credits, user.tradeCount, user.commentCount, user.status, user.commentRestricted ? '제한' : '가능'])); showToast('사용자 CSV를 준비했습니다.'); });
  $('#admin-audit-search').addEventListener('input', renderAudit); $('#admin-audit-type-filter').addEventListener('change', renderAudit); $('#admin-export-audit').addEventListener('click', () => { downloadCsv('jorong-admin-audit.csv', ['시각', '유형', '작업', '대상', '처리자', '상세'], state.auditLogs.map((log) => [log.createdAt, log.category, log.action, log.target, log.operator, log.detail])); showToast('운영 기록 CSV를 준비했습니다.'); });
  modalCancel.addEventListener('click', closeModal); modalClose.addEventListener('click', closeModal); modalConfirm.addEventListener('click', confirmModal); window.addEventListener('keydown', trapModalFocus);
  // 다른 탭의 거래소가 로컬 계정·댓글을 저장하면 관리자 화면도 새로고침 없이 목록을 다시 읽습니다.
  window.addEventListener('storage', async (event) => {
    if (service.getMode() !== 'LOCAL_DEMO' || !['jorong-mvp-local-accounts-v1', 'jorong-mvp-local-comments-v1'].includes(event.key) || !state) return;
    state = await service.load();
    renderAll();
  });

  async function initialize() {
    try {
      state = await service.load();
      const isApi = service.getMode() === 'API';
      $('#admin-mode-badge').textContent = isApi ? '● 관리자 API 연결 모드' : '● 로컬 시연 모드';
      $('#admin-operator-name').textContent = isApi ? '관리자 세션 확인 중' : `운영자 · ${service.getOperator().name}`;
      $('#admin-operator-role').textContent = isApi ? '서버 권한 검증 필요' : '관리자 권한 시연';
      renderAll();
      liveClockTimerId = window.setInterval(renderLiveCountdown, 1000);
      scheduleSyncTimerId = window.setInterval(syncLocalMarketSchedule, 5000);
    } catch (error) {
      $$('.admin-view').forEach((view) => { view.hidden = true; });
      const dashboard = $('#admin-dashboard'); dashboard.hidden = false; dashboard.innerHTML = `<article class="admin-card"><div class="admin-empty"><h2>관리자 접근 권한을 확인할 수 없습니다.</h2><p>${escapeHtml(error.message || '관리자 데이터를 불러오지 못했습니다.')}</p><button class="admin-primary" type="button" onclick="location.reload()">다시 시도</button></div></article>`;
      pageTitle.textContent = '관리자 접근 권한 확인'; pageDescription.textContent = '실제 관리자 권한은 서버에서 검증해야 합니다.';
    }
  }
  initialize();
})();
