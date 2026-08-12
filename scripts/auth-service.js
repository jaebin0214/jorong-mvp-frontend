// [인증 서비스] API 주소를 설정하면 회원·로그인·세션 정보를 서버에서 받아오고, 설정 전에는 화면 확인용 로컬 데이터로 동작합니다.
window.AuthService = (() => {
  const API_BASE_URL = (window.JORONG_API_BASE_URL || '').replace(/\/$/, '');
  const TOKEN_STORAGE_KEY = 'jorong-mvp-access-token';
  const INITIAL_POINTS = 10000;
  const localAccounts = new Map();
  let currentAccount = null;
  let accessToken = sessionStorage.getItem(TOKEN_STORAGE_KEY) || '';

  // [입력값 검사] 사용자 경험을 위한 사전 검사이며, 중복 닉네임과 비밀번호 보안 검사는 반드시 서버에서도 수행해야 합니다.
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

  // [인증 헤더] 백엔드가 세션 쿠키를 쓸 때도, Bearer 토큰을 쓸 때도 함께 사용할 수 있도록 공통 헤더를 만듭니다.
  function getRequestHeaders() {
    return accessToken ? { Authorization: `Bearer ${accessToken}` } : {};
  }

  // [세션 정규화] 로그인·회원가입·/auth/me 응답의 계정/지갑 형태를 하나의 화면용 구조로 통일합니다.
  function applySession(payload = {}) {
    const accountSource = payload.account || payload.user || null;
    const walletSource = payload.wallet || accountSource?.wallet || {};
    const returnedToken = payload.accessToken || payload.token || payload.access_token;

    if (returnedToken) {
      accessToken = returnedToken;
      sessionStorage.setItem(TOKEN_STORAGE_KEY, returnedToken);
    }

    if (!accountSource) return null;
    currentAccount = {
      ...accountSource,
      nickname: accountSource.nickname || accountSource.name,
      points: Number(walletSource.points ?? accountSource.points ?? INITIAL_POINTS),
      investmentLogs: payload.investmentLogs || payload.investments || accountSource.investmentLogs || [],
    };

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

  // [HTTP 요청] 인증 쿠키와 Bearer 토큰을 함께 전송하고, API의 message 오류를 화면에서 사용할 Error로 변환합니다.
  async function request(path, options = {}) {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      credentials: 'include',
      ...options,
      headers: {
        Accept: 'application/json',
        ...getRequestHeaders(),
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(options.headers || {}),
      },
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.message || '인증 요청을 처리하지 못했습니다.');
    return body;
  }

  // [로컬 계정] API 주소가 없을 때만 쓰는 시연용 계정입니다. 실제 서비스의 비밀번호와 포인트는 서버 DB가 보관합니다.
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
    return API_BASE_URL
      ? request(`/auth/nickname-availability?nickname=${encodeURIComponent(normalizedNickname)}`, { method: 'GET' })
      : { available: !localAccounts.has(normalizedNickname) };
  }

  // [회원가입] points는 클라이언트가 보내지 않습니다. 서버가 트랜잭션으로 신규 회원과 초기 10,000 포인트를 생성해야 합니다.
  async function signup(payload) {
    const credentials = validateCredentials(payload);
    const result = API_BASE_URL
      ? await request('/auth/signup', { method: 'POST', body: JSON.stringify(credentials) })
      : createLocalAccount(credentials);
    return result;
  }

  // [로그인] 닉네임과 비밀번호를 서버로 전달하고, 반환된 포인트와 투자 내역을 현재 세션에 보관합니다.
  async function login(payload) {
    const credentials = validateCredentials(payload);
    let result;
    if (API_BASE_URL) {
      result = await request('/auth/login', { method: 'POST', body: JSON.stringify(credentials) });
    } else {
      const local = localAccounts.get(credentials.nickname);
      if (!local || local.password !== credentials.password) throw new Error('닉네임 또는 비밀번호가 일치하지 않습니다.');
      const { password, ...account } = local;
      result = { account, wallet: { points: account.points }, investmentLogs: account.investmentLogs };
    }
    applySession(result);
    return result;
  }

  // [재접속 복원] 서버 인증이 설정되면 앱 시작 시 /auth/me를 불러와 새로고침 후에도 지갑·투자 내역을 복원합니다.
  async function restoreSession() {
    if (!API_BASE_URL) return currentAccount;
    try {
      const result = await request('/auth/me', { method: 'GET' });
      applySession(result);
      return result;
    } catch (_) {
      currentAccount = null;
      return null;
    }
  }

  // [로그아웃] 서버 쿠키 삭제 API가 있으면 호출하고, 브라우저에 보관한 토큰과 화면 세션도 함께 비웁니다.
  async function logout() {
    if (API_BASE_URL) {
      try { await request('/auth/logout', { method: 'POST' }); } catch (_) { /* 서버 로그아웃 실패 시에도 로컬 세션은 제거합니다. */ }
    }
    accessToken = '';
    currentAccount = null;
    sessionStorage.removeItem(TOKEN_STORAGE_KEY);
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
