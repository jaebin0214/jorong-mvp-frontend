// [Supabase 클라이언트] api-config.js에 URL/anon key가 설정된 경우에만 공용 클라이언트를 만듭니다.
// 이 파일은 반드시 (1) supabase-js CDN 스크립트, (2) api-config.js 다음, 그리고
// auth-service.js 등 이 클라이언트를 사용하는 모든 서비스 파일보다 먼저 로드되어야 합니다.
// (index.html / admin.html의 <script> 순서를 그대로 유지해주세요.)
window.JorongSupabase = (() => {
  const url = (window.JORONG_SUPABASE_URL || '').trim();
  const anonKey = (window.JORONG_SUPABASE_ANON_KEY || '').trim();

  // 연결 정보가 비어 있으면 기존과 동일하게 로컬 시연 모드로 동작합니다.
  if (!url || !anonKey) return null;

  if (!window.supabase || typeof window.supabase.createClient !== 'function') {
    // CDN 스크립트가 안 불러와졌거나 script 순서가 바뀐 경우입니다.
    console.error('[JorongSupabase] supabase-js 라이브러리를 찾을 수 없습니다. index.html/admin.html의 CDN <script> 태그 순서를 확인해주세요.');
    return null;
  }

  return window.supabase.createClient(url, anonKey, {
    auth: {
      persistSession: true,   // 새로고침해도 로그인 상태 유지 (Supabase가 자체적으로 localStorage에 세션을 관리합니다)
      autoRefreshToken: true, // 액세스 토큰 만료 전 자동 갱신
      detectSessionInUrl: false,
    },
  });
})();
