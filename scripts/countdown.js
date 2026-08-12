// [거래소 타이머] 백엔드가 있으면 서버 시각·종료 시각을 기준으로, 없으면 MVP용 로컬 시각을 기준으로 동작합니다.
window.MarketCountdown = (() => {
  const config = window.MarketConfig.get();
  const API_BASE_URL = (window.JORONG_API_BASE_URL || '').replace(/\/$/, '');
  const useBackendClock = Boolean(API_BASE_URL);
  const clockUrl = window.JORONG_MARKET_CLOCK_URL || `${API_BASE_URL}/markets/current/clock`;
  const durationMs = config.session.durationHours * 60 * 60 * 1000;
  const safeSessionId = config.session.id.replace(/[^a-zA-Z0-9_-]/g, '-');
  const storageKey = `jorong-market-end-at:${config.session.id}`;
  const cookieKey = `jorong-market-end-at-${safeSessionId}`;
  const countdownElement = document.querySelector('.exchange-countdown');
  let marketSessionId = config.session.id;
  let endAt = useBackendClock ? null : getLocalEndAt();
  let serverOffsetMs = 0;
  let clockReady = !useBackendClock;
  let marketStatus = 'OPEN';
  let hasEnded = false;
  let intervalId = null;
  let syncIntervalId = null;

  // [쿠키 읽기] 로컬 데모에서 localStorage를 쓸 수 없을 때만 보조 저장소를 사용합니다.
  function getCookieValue(name) {
    const prefix = `${name}=`;
    const cookie = document.cookie.split('; ').find((item) => item.startsWith(prefix));
    return cookie ? cookie.slice(prefix.length) : null;
  }

  function persistLocalEndAt(value) {
    try { window.localStorage.setItem(storageKey, String(value)); } catch { /* no-op */ }
    try { document.cookie = `${cookieKey}=${value}; max-age=31536000; path=/; samesite=lax`; } catch { /* no-op */ }
  }

  // [로컬 데모 종료 시각] 실제 API가 연결되지 않은 미리보기에서만 브라우저별 시각을 보관합니다.
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

  // [서버 시간 보정] 기기 시간이 정확하지 않아도 서버 시각을 기준으로 남은 시간을 계산합니다.
  function getNow() {
    return Date.now() + serverOffsetMs;
  }

  function formatRemainingTime(value) {
    const totalSeconds = Math.max(0, Math.ceil((value - getNow()) / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return [hours, minutes, seconds].map((part) => String(part).padStart(2, '0')).join(':');
  }

  function isMarketEnded() {
    return clockReady && (marketStatus === 'CLOSED' || (Number.isFinite(endAt) && getNow() >= endAt));
  }

  // [거래 종료 알림] 종료 시점에 한 번만 이벤트를 발행해 화면과 거래 로직이 함께 멈추도록 합니다.
  function finishMarket() {
    if (hasEnded) return;

    hasEnded = true;
    if (intervalId) window.clearInterval(intervalId);
    if (syncIntervalId) window.clearInterval(syncIntervalId);
    window.dispatchEvent(new CustomEvent('jorong:market-ended', {
      detail: { marketSessionId, endedAt },
    }));
  }

  // [서버 응답 정규화] endsAt이 없더라도 startsAt과 durationHours가 오면 종료 시각을 계산합니다.
  function getRemoteEndAt(payload) {
    const session = payload.session || {};
    const directEndAt = Date.parse(payload.endsAt || session.endsAt || '');
    if (Number.isFinite(directEndAt)) return directEndAt;

    const startsAt = Date.parse(payload.startsAt || session.startsAt || '');
    const remoteDuration = Number(payload.durationHours ?? session.durationHours);
    return Number.isFinite(startsAt) && Number.isFinite(remoteDuration)
      ? startsAt + (remoteDuration * 60 * 60 * 1000)
      : NaN;
  }

  // [백엔드 동기화] 서버가 제공한 종료 시각과 서버 현재 시각으로 모든 브라우저의 타이머를 일치시킵니다.
  async function syncFromServer() {
    if (!useBackendClock || hasEnded) return;

    try {
      const response = await fetch(clockUrl, { headers: { Accept: 'application/json' }, cache: 'no-store' });
      if (!response.ok) throw new Error('거래 시간을 불러오지 못했습니다.');

      const payload = await response.json();
      const remoteEndAt = getRemoteEndAt(payload);
      const remoteServerNow = Date.parse(payload.serverNow || payload.now || '');
      if (!Number.isFinite(remoteEndAt) || !Number.isFinite(remoteServerNow)) {
        throw new Error('거래 시간 응답 형식이 올바르지 않습니다.');
      }

      endAt = remoteEndAt;
      serverOffsetMs = remoteServerNow - Date.now();
      marketSessionId = String(payload.marketSessionId || payload.session?.id || marketSessionId);
      marketStatus = String(payload.status || payload.session?.status || 'OPEN').toUpperCase();
      clockReady = true;
      window.dispatchEvent(new CustomEvent('jorong:market-clock-synced', {
        detail: { marketSessionId, endsAt: endAt, serverNow: remoteServerNow, status: marketStatus },
      }));
      render();
    } catch (error) {
      // 이미 동기화된 시계는 네트워크가 잠시 끊겨도 마지막 서버 보정값으로 계속 표시합니다.
      if (!clockReady && countdownElement) {
        countdownElement.textContent = '--:--:--';
        countdownElement.setAttribute('aria-label', '거래 시간을 확인 중입니다.');
      }
    }
  }

  function render() {
    if (!clockReady || !Number.isFinite(endAt)) {
      if (countdownElement) {
        countdownElement.textContent = '--:--:--';
        countdownElement.setAttribute('aria-label', '거래 시간을 확인 중입니다.');
      }
      return;
    }

    const isExpired = isMarketEnded();
    if (countdownElement) {
      countdownElement.textContent = isExpired ? '00:00:00' : formatRemainingTime(endAt);
      countdownElement.removeAttribute('aria-label');
    }
    if (isExpired) finishMarket();
  }

  render();
  intervalId = window.setInterval(render, 1000);
  if (useBackendClock) {
    syncFromServer();
    // 장시간 접속한 사용자의 기기 시계 오차와 회차 상태 변경을 30초마다 보정합니다.
    syncIntervalId = window.setInterval(syncFromServer, 30_000);
  }

  return Object.freeze({
    getEndAt: () => endAt,
    getSessionId: () => marketSessionId,
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
