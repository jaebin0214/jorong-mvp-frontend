// [실행 모드] localhost·사설 개발 주소·file://에서 열면 로컬 시연 모드를 기본 사용합니다.
// 로컬에서도 실제 Supabase를 확인해야 할 때는 주소 끝에 ?demo=0을 붙이고,
// 배포 주소에서 시연 모드를 강제할 때만 ?demo=1을 사용합니다.
(() => {
  const locationInfo = window.location || {};
  const hostname = String(locationInfo.hostname || '').toLowerCase();
  const query = new URLSearchParams(String(locationInfo.search || ''));
  const demoOverride = query.get('demo');
  const isLoopback = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(hostname);
  const isPrivateNetwork = /^10\./.test(hostname)
    || /^192\.168\./.test(hostname)
    || /^172\.(1[6-9]|2\d|3[01])\./.test(hostname);
  const isLocalRuntime = locationInfo.protocol === 'file:' || isLoopback || isPrivateNetwork;
  const forcedDemo = demoOverride === '1' || demoOverride === 'true';
  const forcedApi = demoOverride === '0' || demoOverride === 'false';

  window.JORONG_DEMO_MODE = window.JORONG_DEMO_MODE === true || forcedDemo || (!forcedApi && isLocalRuntime);
})();

// [Supabase 연결 설정] 배포 환경은 실제 Supabase 프로젝트를 사용하고, 로컬 시연 모드는 연결을 비웁니다.
// Supabase 대시보드 > Project Settings > API 에서 확인할 수 있습니다.
//   - Project URL 예시: https://xxxxxxxxxxxxxxxxxxxx.supabase.co
//   - anon public key : eyJhbGciOi... 로 시작하는 긴 문자열
// 주의: 여기에는 반드시 "anon public" 키만 넣어야 합니다. service_role 키를 여기 넣으면
// 관리자 권한이 브라우저에 그대로 노출되므로 절대 넣지 마세요.
if (window.JORONG_DEMO_MODE) {
  window.JORONG_SUPABASE_URL = '';
  window.JORONG_SUPABASE_ANON_KEY = '';
} else {
  window.JORONG_SUPABASE_URL = window.JORONG_SUPABASE_URL || 'https://esjgfxswvtbdbtahlmov.supabase.co';
  window.JORONG_SUPABASE_ANON_KEY = window.JORONG_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVzamdmeHN3dnRiZGJ0YWhsbW92Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYzODkyMDAsImV4cCI6MjEwMTk2NTIwMH0.MXmsvdYNwMvO6tCRHsRSlckBJ-HwM6FXMc-Y1uJ4PjI';
}

// [이전 방식 정리] 예전에는 커스텀 REST 서버 주소(JORONG_API_BASE_URL)를 기준으로 로컬/서버 모드를
// 나눴지만, 지금은 Supabase 프로젝트에 직접 연결하는 방식으로 확정되어 더 이상 사용하지 않습니다.
// (각 서비스 파일은 이제 window.JorongSupabase 존재 여부로 연결 상태를 판단합니다. scripts/supabase-client.js 참고)
window.JORONG_API_BASE_URL = '';
