// [서버 기준 타이머] 거래 중에는 closeAt, 종료 뒤에는 nextOpenAt을 서버 시각 보정값으로 표시합니다.
window.MarketCountdown = (() => {
  const config = window.MarketConfig.get();
  const supabaseClient = window.JorongSupabase;
  const useBackendClock = Boolean(supabaseClient);
  const marketAvailable = config.marketAvailable === true;
  const hasNextMarket = config.session.hasNextMarket === true;
  const durationMs = config.session.durationHours * 60 * 60 * 1000;
  const safeSessionId = config.session.id.replace(/[^a-zA-Z0-9_-]/g, '-');
  const storageKey = `jorong-market-end-at:${config.session.id}`;
  const cookieKey = `jorong-market-end-at-${safeSessionId}`;
  const countdownElement = document.querySelector('.exchange-countdown');
  const countdownLabel = document.querySelector('#exchange-countdown-label');
  let marketSessionId = config.session.id;
  let endAt = marketAvailable && !useBackendClock ? getLocalEndAt() : null;
  let nextOpenAt = marketAvailable && !useBackendClock && hasNextMarket ? getLocalNextOpenAt(endAt) : null;
  let serverOffsetMs = 0;
  let clockReady = marketAvailable && !useBackendClock;
  // 관리자 페이지가 수동 종료한 로컬 회차도 타이머가 남아 있더라도 즉시 종료 상태로 취급합니다.
  let marketStatus = String(config.session.status || 'OPEN').toUpperCase();
  let hasEnded = false;
  let intervalId = null;
  let syncIntervalId = null;

  function getCookieValue(name) {
    const prefix = `${name}=`;
    const cookie = document.cookie.split('; ').find((item) => item.startsWith(prefix));
    return cookie ? cookie.slice(prefix.length) : null;
  }

  function persistLocalEndAt(value) {
    try { window.localStorage.setItem(storageKey, String(value)); } catch { /* no-op */ }
    try { document.cookie = `${cookieKey}=${value}; max-age=31536000; path=/; samesite=lax`; } catch { /* no-op */ }
  }

  // [로컬 시연 시간] 서버가 없는 정적 MVP에서만 브라우저 저장소로 종료 시각을 임시 보관합니다.
  function getLocalEndAt() {
    if (config.session.startsAt) return Date.parse(config.session.startsAt) + durationMs;
    let savedEndAt = 0;
    try { savedEndAt = Number(window.localStorage.getItem(storageKey)); } catch { /* no-op */ }
    if (!Number.isFinite(savedEndAt) || savedEndAt <= 0) savedEndAt = Number(getCookieValue(cookieKey));
    if (Number.isFinite(savedEndAt) && savedEndAt > 0) return savedEndAt;
    const newEndAt = Date.now() + durationMs;
    persistLocalEndAt(newEndAt);
    return newEndAt;
  }

  function getLocalNextOpenAt(closeAt) {
    const configured = Date.parse(config.session.nextOpenAt || '');
    return Number.isFinite(configured) ? configured : closeAt + (24 * 60 * 60 * 1000);
  }

  function getNow() {
    return Date.now() + serverOffsetMs;
  }

  function formatRemainingTime(targetTime) {
    const totalSeconds = Math.max(0, Math.ceil((targetTime - getNow()) / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return [hours, minutes, seconds].map((part) => String(part).padStart(2, '0')).join(':');
  }

  function isMarketEnded() {
    return marketAvailable && clockReady && (['CLOSED', 'SETTLED', 'ARCHIVED'].includes(marketStatus) || (Number.isFinite(endAt) && getNow() >= endAt));
  }

  // [종료 알림] 한 회차당 한 번만 발행하되, 다음 장 카운트다운은 계속 갱신합니다.
  function finishMarket() {
    if (hasEnded) return;
    hasEnded = true;
    if (marketStatus === 'OPEN') marketStatus = 'CLOSED';
    window.dispatchEvent(new CustomEvent('jorong:market-ended', {
      detail: { marketSessionId, endedAt: endAt, nextOpenAt, status: marketStatus },
    }));
  }

  function getRemoteEndAt(payload) {
    const session = payload.session || payload.market || {};
    const directEndAt = Date.parse(payload.endsAt || payload.closeAt || session.endsAt || session.closeAt || '');
    if (Number.isFinite(directEndAt)) return directEndAt;
    const startsAt = Date.parse(payload.startsAt || payload.openAt || session.startsAt || session.openAt || '');
    const remoteDuration = Number(payload.durationHours ?? session.durationHours);
    return Number.isFinite(startsAt) && Number.isFinite(remoteDuration) ? startsAt + (remoteDuration * 60 * 60 * 1000) : NaN;
  }

  function getRemoteNextOpenAt(payload) {
    const session = payload.session || payload.market || {};
    return Date.parse(payload.nextOpenAt || session.nextOpenAt || '');
  }

  // [서버 시간 보정] 모든 접속자가 같은 closeAt/nextOpenAt을 기준으로 볼 수 있도록 서버 시계와 차이를 계산합니다.
  async function syncFromServer() {
    if (!useBackendClock) return;
    try {
      const { data, error } = await supabaseClient.rpc('get_market_clock');
      if (error) throw error;
      const payload = data || {};
      const remoteEndAt = getRemoteEndAt(payload);
      const remoteServerNow = Date.parse(payload.serverNow || payload.now || '');
      const remoteNextOpenAt = getRemoteNextOpenAt(payload);
      if (!Number.isFinite(remoteEndAt) || !Number.isFinite(remoteServerNow)) throw new Error('거래 시간 응답 형식이 올바르지 않습니다.');

      endAt = remoteEndAt;
      nextOpenAt = Number.isFinite(remoteNextOpenAt) ? remoteNextOpenAt : null;
      serverOffsetMs = remoteServerNow - Date.now();
      marketSessionId = String(payload.marketSessionId || payload.market?.id || payload.session?.id || marketSessionId);
      marketStatus = String(payload.status || payload.market?.status || payload.session?.status || 'OPEN').toUpperCase();
      clockReady = true;
      window.dispatchEvent(new CustomEvent('jorong:market-clock-synced', {
        detail: { marketSessionId, endsAt: endAt, nextOpenAt, serverNow: remoteServerNow, status: marketStatus },
      }));
      render();
    } catch (_) {
      if (!clockReady && countdownElement) {
        countdownElement.textContent = '--:--:--';
        countdownElement.setAttribute('aria-label', '거래 시간을 확인 중입니다.');
      }
    }
  }

  function render() {
    if (!marketAvailable) {
      if (countdownLabel) countdownLabel.textContent = '다음 거래 준비 중';
      if (countdownElement) countdownElement.textContent = '--:--:--';
      return;
    }
    if (!clockReady || !Number.isFinite(endAt)) {
      if (countdownElement) countdownElement.textContent = '--:--:--';
      return;
    }

    const ended = isMarketEnded();
    if (ended) finishMarket();
    const showingNextMarket = hasEnded;
    if (countdownLabel) countdownLabel.textContent = showingNextMarket ? '다음 장 시작까지' : '오늘의 장 마감까지';
    if (countdownElement) {
      countdownElement.classList.toggle('is-next-market', showingNextMarket);
      countdownElement.textContent = showingNextMarket && Number.isFinite(nextOpenAt)
        ? formatRemainingTime(nextOpenAt)
        : showingNextMarket
          ? '--:--:--'
          : formatRemainingTime(endAt);
      countdownElement.removeAttribute('aria-label');
    }
  }

  render();
  intervalId = window.setInterval(render, 1000);
  if (marketAvailable && useBackendClock) {
    syncFromServer();
    syncIntervalId = window.setInterval(syncFromServer, 30_000);
  }

  return Object.freeze({
    getEndAt: () => endAt,
    getNextOpenAt: () => nextOpenAt,
    getServerNow: getNow,
    getSessionId: () => marketSessionId,
    getStatus: () => marketStatus,
    isReady: () => clockReady,
    requiresServerClock: () => useBackendClock,
    isEnded: () => {
      if (isMarketEnded()) finishMarket();
      return hasEnded;
    },
    sync: syncFromServer,
    stop: () => {
      if (intervalId) window.clearInterval(intervalId);
      if (syncIntervalId) window.clearInterval(syncIntervalId);
    },
  });
})();
