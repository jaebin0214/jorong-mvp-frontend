// [거래소 타이머] Supabase가 설정되어 있으면 서버(trading_weeks) 기준 종료 시각으로, 없으면 MVP용 로컬 시각을 기준으로 동작합니다.
//
// ⚠️ 중요: 원래 파일은 `window.JORONG_API_BASE_URL`이 있는지로 "백엔드 연결 여부"를 판단했습니다.
// api-config.js를 Supabase 방식으로 바꾸면서 이 변수를 더 이상 설정하지 않기 때문에, 원본 코드를 그대로 두면
// `useBackendClock`이 항상 false가 되어 서버와 동기화되지 않은 "로컬 브라우저 타이머"로 조용히 되돌아갑니다.
// 아래에서는 `window.SupabaseClient` 유무로 판단하도록 바꾸고, REST fetch 대신 Supabase 조회로 교체했습니다.
window.MarketCountdown = (() => {
  const config = window.MarketConfig.get();
  const useBackendClock = Boolean(window.SupabaseClient);
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

  function getCookieValue(name) {
    const prefix = `${name}=`;
    const cookie = document.cookie.split('; ').find((item) => item.startsWith(prefix));
    return cookie ? cookie.slice(prefix.length) : null;
  }

  function persistLocalEndAt(value) {
    try { window.localStorage.setItem(storageKey, String(value)); } catch { /* no-op */ }
    try { document.cookie = `${cookieKey}=${value}; max-age=31536000; path=/; samesite=lax`; } catch { /* no-op */ }
  }

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

  function finishMarket() {
    if (hasEnded) return;
    hasEnded = true;
    if (intervalId) window.clearInterval(intervalId);
    if (syncIntervalId) window.clearInterval(syncIntervalId);
    window.dispatchEvent(new CustomEvent('jorong:market-ended', {
      detail: { marketSessionId, endedAt: endAt },
    }));
  }

  // [Supabase 동기화] 현재 종목(getActiveStock)이 속한 trading_weeks의 ends_at/status를 조회합니다.
  // ⚠️ Supabase(PostgREST)에는 "서버 현재 시각"만 돌려주는 기본 API가 없어서, serverOffsetMs는 0으로 둡니다
  //    (= 각자 기기 시계를 그대로 사용). 모든 사용자가 같은 endAt을 보는 건 보장되지만, 기기 시계가 부정확한
  //    사용자는 카운트다운이 몇 초 어긋날 수 있습니다. 초 단위 정밀 동기화가 필요하면 `select now()`만 반환하는
  //    Postgres 함수를 하나 만들어 RPC로 호출하도록 이 부분만 바꾸면 됩니다.
  async function syncFromServer() {
    if (!useBackendClock || hasEnded) return;

    try {
      const stock = await window.getActiveStock({ force: true });
      const { data: week, error } = await window.SupabaseClient
        .from('trading_weeks')
        .select('id, ends_at, status')
        .eq('id', stock.week_id)
        .single();
      if (error) throw new Error(error.message);

      const remoteEndAt = Date.parse(week.ends_at);
      if (!Number.isFinite(remoteEndAt)) throw new Error('거래 종료 시각 형식이 올바르지 않습니다.');

      endAt = remoteEndAt;
      serverOffsetMs = 0;
      marketSessionId = String(stock.week_id);
      marketStatus = (stock.status === 'trading' && week.status === 'open') ? 'OPEN' : 'CLOSED';
      clockReady = true;
      window.dispatchEvent(new CustomEvent('jorong:market-clock-synced', {
        detail: { marketSessionId, endsAt: endAt, serverNow: Date.now(), status: marketStatus },
      }));
      render();
    } catch (error) {
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
