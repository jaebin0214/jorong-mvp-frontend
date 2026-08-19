// [인증 서비스] Supabase 프로젝트에 연결되어 있으면 Edge Function(signup-with-nickname/login-with-nickname)으로
// 회원가입·로그인·세션 정보를 받아오고, 연결 전(scripts/api-config.js에 URL/키가 비어있을 때)에는
// 화면 확인용 로컬 데이터로 동작합니다. (scripts/supabase-client.js가 만든 window.JorongSupabase 사용)
window.AuthService = (() => {
  const supabaseClient = window.JorongSupabase;
  const SUPABASE_URL = (window.JORONG_SUPABASE_URL || '').replace(/\/$/, '');
  const SUPABASE_ANON_KEY = window.JORONG_SUPABASE_ANON_KEY || '';
  const LOCAL_SESSION_STORAGE_KEY = 'jorong-mvp-local-session';
  // [로컬 계정 디렉터리] 관리자 화면이 실제 로컬 가입자를 읽을 수 있도록 비밀번호 없이 계정 요약만 공유합니다.
  const LOCAL_ACCOUNT_DIRECTORY_KEY = 'jorong-mvp-local-accounts-v1';
  // [신규 가입 보너스] 로컬 시연 신규 계정도 서버 운영 정책과 같은 100,000 크레딧으로 시작합니다.
  const INITIAL_POINTS = 100000;
  const localAccounts = new Map();
  let currentAccount = null;
  // [세션 복원 상태] 라우팅이 Supabase 세션 확인보다 먼저 로그인 화면으로 이동시키지 않도록,
  // 최초 restoreSession() 완료 여부를 별도로 보관합니다.
  let hasRestoredSession = false;

  // [안전한 탭 저장소] 브라우저 정책으로 sessionStorage가 막혀도 인증 화면 전체가 멈추지 않게 합니다.
  function readSessionStorage(key) {
    try { return window.sessionStorage.getItem(key) || ''; } catch (_) { return ''; }
  }

  function writeSessionStorage(key, value) {
    try { window.sessionStorage.setItem(key, value); } catch (_) { /* no-op */ }
  }

  function removeSessionStorage(key) {
    try { window.sessionStorage.removeItem(key); } catch (_) { /* no-op */ }
  }

  function readLocalAccountDirectory() {
    try {
      const stored = JSON.parse(window.localStorage.getItem(LOCAL_ACCOUNT_DIRECTORY_KEY) || 'null');
      return stored?.version === 1 && Array.isArray(stored.accounts) ? stored : { version: 1, accounts: [] };
    } catch (_) {
      return { version: 1, accounts: [] };
    }
  }

  function writeLocalAccountDirectory(directory) {
    try { window.localStorage.setItem(LOCAL_ACCOUNT_DIRECTORY_KEY, JSON.stringify(directory)); } catch (_) { /* no-op */ }
  }

  // 운영 화면에는 아이디·포인트·생성 시각만 보냅니다. 비밀번호와 인증 토큰은 공유 저장소에 넣지 않습니다.
  // Supabase 연결 시에는 실제 계정 목록을 admin_* RPC로 받아오므로(추후 단계) 이 로컬 미러링은 쓰지 않습니다.
  function mirrorLocalAccount(account) {
    if (supabaseClient || !account?.id || !account?.nickname) return;
    const directory = readLocalAccountDirectory();
    const safeAccount = {
      id: String(account.id),
      nickname: String(account.nickname),
      points: Math.max(0, Math.round(Number(account.points) || 0)),
      createdAt: account.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const index = directory.accounts.findIndex((item) => item.id === safeAccount.id || item.nickname === safeAccount.nickname);
    if (index >= 0) directory.accounts[index] = { ...directory.accounts[index], ...safeAccount };
    else directory.accounts.push(safeAccount);
    writeLocalAccountDirectory(directory);
  }

  // [로컬 데모 세션] Supabase 미연결 시에도 새로고침으로 로그인 화면이 초기화되지 않도록
  // 비밀번호를 제외한 계정 정보만 현재 브라우저 탭의 sessionStorage에 보관합니다.
  // Supabase 연결 시에는 supabase-js가 세션을 자체적으로 localStorage에 보관하므로 이 저장소는 쓰지 않습니다.
  function persistLocalSession(account) {
    if (supabaseClient || !account?.id || !account?.nickname) return;
    const storedPoints = Number(account.points);
    const safeAccount = {
      id: account.id,
      nickname: account.nickname,
      points: Number.isFinite(storedPoints) && storedPoints >= 0 ? storedPoints : INITIAL_POINTS,
      investmentLogs: Array.isArray(account.investmentLogs) ? account.investmentLogs : [],
      createdAt: account.createdAt,
    };
    writeSessionStorage(LOCAL_SESSION_STORAGE_KEY, JSON.stringify(safeAccount));
  }

  function getPersistedLocalSession() {
    if (supabaseClient) return null;
    try {
      const saved = JSON.parse(readSessionStorage(LOCAL_SESSION_STORAGE_KEY) || 'null');
      return saved?.id && saved?.nickname ? saved : null;
    } catch (_) {
      removeSessionStorage(LOCAL_SESSION_STORAGE_KEY);
      return null;
    }
  }

  // [입력값 검사] 화면에서는 아이디로 부르되, 내부 필드명 nickname을 유지합니다.
  // (백엔드는 2~16자까지 허용하지만, 화면 문구·입력창(maxlength=12)에 맞춰 여기서는 2~12자로 더 엄격하게 검사합니다.)
  function validateCredentials({ nickname, password }) {
    const normalizedNickname = String(nickname || '').trim();
    const normalizedPassword = String(password || '');

    if (normalizedNickname.length < 2 || normalizedNickname.length > 12) {
      throw new Error('아이디는 2~12자로 입력해주세요.');
    }
    if (normalizedPassword.length < 8) {
      throw new Error('비밀번호는 8자 이상 입력해주세요.');
    }
    return { nickname: normalizedNickname, password: normalizedPassword };
  }

  // [호환용] Supabase 연결 이후에는 supabase-js가 세션의 Authorization 헤더를 자동으로 붙여주므로
  // 실제로는 쓰이지 않습니다. 아직 fetch 기반으로 남아있는 다른 서비스 파일(다음 단계에서 전환 예정)이
  // 호출해도 에러가 나지 않도록 빈 객체만 반환합니다.
  function getRequestHeaders() {
    return {};
  }

  // [Edge Function 호출] signup-with-nickname / login-with-nickname / check-nickname은 로그인 전
  // 상태에서 호출하므로 anon key로 인증합니다 (Supabase Edge Function은 apikey/Authorization 헤더 필수).
  async function requestEdgeFunction(name, payload) {
    const response = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify(payload),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body.ok === false) throw new Error(body.message || '인증 요청을 처리하지 못했습니다.');
    return body;
  }

  // [세션 정규화] Edge Function 응답(account/wallet/session)을 화면용 구조로 통일하고,
  // 반환된 access_token/refresh_token으로 supabase-js 세션을 실제로 성립시킵니다.
  // 이후의 모든 supabase.rpc()/from() 호출은 이 세션의 로그인 사용자로 자동 인증됩니다.
  async function applySession(payload = {}) {
    const accountSource = payload.account || payload.user || null;
    const walletSource = payload.wallet || accountSource?.wallet || {};

    if (supabaseClient && payload.session?.access_token && payload.session?.refresh_token) {
      const { error } = await supabaseClient.auth.setSession({
        access_token: payload.session.access_token,
        refresh_token: payload.session.refresh_token,
      });
      if (error) throw new Error('세션을 저장하지 못했습니다. 다시 로그인해주세요.');
    }

    if (!accountSource) return null;
    currentAccount = {
      ...accountSource,
      nickname: accountSource.nickname || accountSource.name,
      points: Number(walletSource.points ?? accountSource.points ?? INITIAL_POINTS),
      investmentLogs: payload.investmentLogs || payload.investments || accountSource.investmentLogs || [],
    };
    persistLocalSession(currentAccount);
    mirrorLocalAccount(currentAccount);

    // [화면 동기화 이벤트] 투자 금액·마이페이지 등 독립된 UI 파일이 로그인 정보를 직접 참조하지 않도록 이벤트로 전달합니다.
    window.dispatchEvent(new CustomEvent('jorong:auth-session', {
      detail: {
        account: currentAccount,
        wallet: { points: currentAccount.points },
        investmentLogs: currentAccount.investmentLogs,
      },
    }));
    return currentAccount;
  }

  // [로컬 계정] Supabase 미연결일 때만 쓰는 시연용 계정입니다. 실제 서비스의 비밀번호와 포인트는 서버 DB가 보관합니다.
  function createLocalAccount(credentials) {
    const directory = readLocalAccountDirectory();
    if (localAccounts.has(credentials.nickname) || directory.accounts.some((account) => account.nickname === credentials.nickname)) throw new Error('이미 사용 중인 아이디입니다.');
    const account = {
      id: `local-account-${Date.now()}`,
      nickname: credentials.nickname,
      points: INITIAL_POINTS,
      investmentLogs: [],
      createdAt: new Date().toISOString(),
    };
    localAccounts.set(credentials.nickname, { ...account, password: credentials.password });
    mirrorLocalAccount(account);
    return { account, wallet: { points: INITIAL_POINTS }, investmentLogs: [] };
  }

  async function checkNicknameAvailability(nickname) {
    const normalizedNickname = String(nickname || '').trim();
    if (normalizedNickname.length < 2 || normalizedNickname.length > 12) {
      throw new Error('아이디는 2~12자로 입력해주세요.');
    }
    if (!supabaseClient) {
      return { available: !localAccounts.has(normalizedNickname) && !readLocalAccountDirectory().accounts.some((account) => account.nickname === normalizedNickname) };
    }
    const body = await requestEdgeFunction('check-nickname', { nickname: normalizedNickname });
    return { available: !!body.available, message: body.message };
  }

  // [회원가입] points는 클라이언트가 보내지 않습니다. 서버가 트랜잭션으로 신규 회원과 초기 100,000 크레딧을 생성합니다.
  // Supabase 연결 시 응답에는 1회성 평문 복구 코드(recovery_code)가 포함되며, auth-ui.js가 이를 화면에 표시합니다.
  async function signup(payload) {
    const credentials = validateCredentials(payload);
    const result = supabaseClient
      ? await requestEdgeFunction('signup-with-nickname', credentials)
      : createLocalAccount(credentials);
    await applySession(result);
    return result;
  }

  // [로그인] 아이디와 비밀번호를 Edge Function으로 전달하고, 반환된 세션·포인트를 현재 화면에 반영합니다.
  async function login(payload) {
    const credentials = validateCredentials(payload);
    let result;
    if (supabaseClient) {
      result = await requestEdgeFunction('login-with-nickname', credentials);
    } else {
      const local = localAccounts.get(credentials.nickname);
      if (!local || local.password !== credentials.password) throw new Error('아이디 또는 비밀번호가 일치하지 않습니다.');
      const { password, ...account } = local;
      result = { account, wallet: { points: account.points }, investmentLogs: account.investmentLogs };
    }
    await applySession(result);
    return result;
  }

  // [재접속 복원] Supabase 연결 시에는 supabase-js가 보관해둔 세션으로 profiles/wallets를 다시 읽어 복원하고,
  // (profiles는 전체 공개 SELECT, wallets는 본인 행만 SELECT 가능하도록 RLS가 이미 열려 있습니다)
  // 로컬 시연에서는 비밀번호를 제외한 탭 세션으로 로그인 상태를 복원합니다.
  async function restoreSession() {
    try {
      if (!supabaseClient) {
        if (currentAccount) return currentAccount;
        const savedAccount = getPersistedLocalSession();
        return savedAccount ? applySession({ account: savedAccount, wallet: { points: savedAccount.points }, investmentLogs: savedAccount.investmentLogs }) : null;
      }
      const { data: { session }, error: sessionError } = await supabaseClient.auth.getSession();
      if (sessionError || !session) {
        currentAccount = null;
        return null;
      }
      const [{ data: profile, error: profileError }, { data: wallet }] = await Promise.all([
        supabaseClient.from('profiles').select('id, nickname, created_at').eq('id', session.user.id).maybeSingle(),
        supabaseClient.from('wallets').select('balance').eq('user_id', session.user.id).maybeSingle(),
      ]);
      if (profileError || !profile) {
        currentAccount = null;
        return null;
      }
      return applySession({
        account: { id: profile.id, nickname: profile.nickname, createdAt: profile.created_at },
        wallet: { points: wallet?.balance ?? 0 },
        investmentLogs: [],
      });
    } catch (_) {
      currentAccount = null;
      return null;
    } finally {
      // 실패·비로그인도 "복원 확인 완료" 상태로 처리해야 보호 화면이 무한 대기하지 않습니다.
      hasRestoredSession = true;
    }
  }

  // [로그아웃] Supabase 세션을 폐기하고, 브라우저에 남아있던 로컬 시연 세션도 함께 비웁니다.
  async function logout() {
    if (supabaseClient) {
      try { await supabaseClient.auth.signOut(); } catch (_) { /* 서버 로그아웃 실패 시에도 로컬 상태는 정리합니다. */ }
    }
    currentAccount = null;
    removeSessionStorage(LOCAL_SESSION_STORAGE_KEY);
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
    isSessionRestored: () => hasRestoredSession,
    // [로컬 지갑 동기화] 투자 시연이 바꾼 잔액을 관리자 목록에도 반영합니다. (Supabase 연결 시에는 서버가 잔액을 관리하므로 no-op)
    updateLocalWalletPoints: (points) => {
      if (supabaseClient || !currentAccount || !Number.isFinite(Number(points))) return;
      currentAccount.points = Math.max(0, Math.round(Number(points)));
      persistLocalSession(currentAccount);
      mirrorLocalAccount(currentAccount);
    },
  });
})();
