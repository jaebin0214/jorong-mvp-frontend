// [인증 서비스] Supabase 설정이 있으면 Edge Function(회원가입/로그인) + Supabase 세션으로 동작하고,
// 없을 때만 화면 확인용 로컬 데이터로 동작합니다. 반환 형태(account/wallet/investmentLogs)는 기존과 동일하게 유지해
// auth-ui.js, header-auth-ui.js 등 이 서비스를 쓰는 다른 파일들이 수정 없이 그대로 동작하도록 했습니다.
window.AuthService = (() => {
  const INITIAL_POINTS = 100000;
  // ⚠️ 백엔드 app_settings.seed.signup 기본값은 100,000입니다. 화면 표시 단위(KRW)와 실제 시드 포인트 값을 어떻게
  // 맞출지(그대로 100,000으로 바꿀지, 표시 스케일을 나눌지) 기획/백엔드와 확인 후 이 상수를 맞춰주세요.
  const localAccounts = new Map();
  let currentAccount = null;

  function validateCredentials({ nickname, password }) {
    const normalizedNickname = String(nickname || '').trim();
    const normalizedPassword = String(password || '');
    if (normalizedNickname.length < 2 || normalizedNickname.length > 12) {
      throw new Error('닉네임은 2~12자로 입력해주세요.');
    }
    if (normalizedPassword.length < 8) {
      throw new Error('비밀번호는 8자 이상 입력해주세요.');
    }
    return { nickname: normalizedNickname, password: normalizedPassword };
  }

  // supabase-js가 rpc()/from() 호출에는 세션 토큰을 자동으로 실어주므로 더 이상 수동으로 만들 필요가 없습니다.
  // 다른 서비스 파일이 이 함수를 참조하고 있어 시그니처만 유지합니다.
  function getRequestHeaders() {
    return {};
  }

  function applySession(payload = {}) {
    const accountSource = payload.account || payload.user || null;
    const walletSource = payload.wallet || accountSource?.wallet || {};

    if (!accountSource) return null;
    currentAccount = {
      ...accountSource,
      nickname: accountSource.nickname || accountSource.name,
      points: Number(walletSource.points ?? accountSource.points ?? INITIAL_POINTS),
      investmentLogs: payload.investmentLogs || payload.investments || accountSource.investmentLogs || [],
    };

    window.dispatchEvent(new CustomEvent('jorong:auth-session', {
      detail: {
        account: currentAccount,
        wallet: { points: currentAccount.points },
        investmentLogs: currentAccount.investmentLogs,
      },
    }));
    return currentAccount;
  }

  async function callEdgeFunction(name, body) {
    const res = await fetch(`${window.JORONG_SUPABASE_URL}/functions/v1/${name}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: window.JORONG_SUPABASE_ANON_KEY },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!data.ok) {
      const err = new Error(data.message || '요청을 처리하지 못했습니다.');
      err.code = data.code;
      err.remainingAttempts = data.remaining_attempts;
      throw err;
    }
    return data;
  }

  async function fetchWalletAndProfile() {
    const [{ data: wallet }, { data: profile }] = await Promise.all([
      window.SupabaseClient.from('wallets').select('balance').single(),
      window.SupabaseClient.from('profiles').select('nickname, is_admin').single(),
    ]);
    return { wallet, profile };
  }

  function createLocalAccount(credentials) {
    if (localAccounts.has(credentials.nickname)) throw new Error('이미 사용 중인 닉네임입니다.');
    const account = {
      id: `local-account-${Date.now()}`,
      nickname: credentials.nickname,
      points: INITIAL_POINTS,
      investmentLogs: [],
      createdAt: new Date().toISOString(),
    };
    localAccounts.set(credentials.nickname, { ...account, password: credentials.password });
    return { account, wallet: { points: INITIAL_POINTS }, investmentLogs: [] };
  }

  async function checkNicknameAvailability(nickname) {
    const normalizedNickname = String(nickname || '').trim();
    if (normalizedNickname.length < 2 || normalizedNickname.length > 12) {
      throw new Error('닉네임은 2~12자로 입력해주세요.');
    }
    if (!window.SupabaseClient) return { available: !localAccounts.has(normalizedNickname) };

    // ⚠️ check-nickname 응답의 정확한 필드명(ok/available/message)을 실제로 한 번 호출해서 콘솔로 확인하고 맞춰주세요.
    const data = await callEdgeFunction('check-nickname', { nickname: normalizedNickname });
    return { available: data.ok !== false, message: data.message };
  }

  // [회원가입] 성공 시 즉시 세션을 설정해 자동로그인 상태로 만듭니다 (닉네임 로그인 구현 가이드 4-2절 기준).
  async function signup(payload) {
    const credentials = validateCredentials(payload);
    if (!window.SupabaseClient) {
      const result = createLocalAccount(credentials);
      applySession(result);
      return result;
    }

    const data = await callEdgeFunction('signup-with-nickname', credentials);
    await window.SupabaseClient.auth.setSession(data.session);
    const { wallet } = await fetchWalletAndProfile();

    const result = {
      account: { id: data.session.user.id, nickname: data.nickname || credentials.nickname },
      wallet: { points: wallet?.balance ?? INITIAL_POINTS },
      investmentLogs: [],
      recoveryCode: data.recovery_code,
      // ⚠️ recoveryCode는 이 시점에 딱 한 번만 내려옵니다. auth-ui.js의 가입 완료 처리부에서
      // signup() 반환값의 recoveryCode를 반드시 화면에 표시하도록 연결해주세요 (안 하면 영구 소실).
    };
    applySession(result);
    return result;
  }

  async function login(payload) {
    const credentials = validateCredentials(payload);
    if (!window.SupabaseClient) {
      const local = localAccounts.get(credentials.nickname);
      if (!local || local.password !== credentials.password) throw new Error('닉네임 또는 비밀번호가 일치하지 않습니다.');
      const { password, ...account } = local;
      const result = { account, wallet: { points: account.points }, investmentLogs: account.investmentLogs };
      applySession(result);
      return result;
    }

    const data = await callEdgeFunction('login-with-nickname', credentials);
    await window.SupabaseClient.auth.setSession(data.session);
    const { wallet, profile } = await fetchWalletAndProfile();

    const result = {
      account: { id: data.session.user.id, nickname: profile?.nickname || credentials.nickname },
      wallet: { points: wallet?.balance ?? 0 },
      investmentLogs: [],
    };
    applySession(result);
    return result;
  }

  // [재접속 복원] Supabase 세션이 localStorage에 남아있으면(기본 동작) 새로고침 후에도 지갑/닉네임을 복원합니다.
  async function restoreSession() {
    if (!window.SupabaseClient) return currentAccount;
    const { data: { session } } = await window.SupabaseClient.auth.getSession();
    if (!session) {
      currentAccount = null;
      return null;
    }
    try {
      const { wallet, profile } = await fetchWalletAndProfile();
      const result = {
        account: { id: session.user.id, nickname: profile?.nickname },
        wallet: { points: wallet?.balance ?? 0 },
        investmentLogs: [],
      };
      applySession(result);
      return result;
    } catch (_) {
      currentAccount = null;
      return null;
    }
  }

  async function logout() {
    if (window.SupabaseClient) {
      try { await window.SupabaseClient.auth.signOut(); } catch (_) { /* 세션 정리는 계속 진행 */ }
    }
    currentAccount = null;
    window.dispatchEvent(new CustomEvent('jorong:auth-session', { detail: { account: null, wallet: null, investmentLogs: [] } }));
  }

  return Object.freeze({
    checkNicknameAvailability,
    signup,
    login,
    restoreSession,
    logout,
    getRequestHeaders,
    getCurrentAccount: () => currentAccount,
  });
})();
