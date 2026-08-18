// [Supabase 연결 설정] 아래 두 값을 채우면 각 화면이 로컬 시연 데이터 대신 실제 Supabase 프로젝트를 사용합니다.
// Supabase 대시보드 > Project Settings > API 에서 확인할 수 있습니다.
//   - Project URL 예시: https://xxxxxxxxxxxxxxxxxxxx.supabase.co
//   - anon public key : eyJhbGciOi... 로 시작하는 긴 문자열
// 주의: 여기에는 반드시 "anon public" 키만 넣어야 합니다. service_role 키를 여기 넣으면
// 관리자 권한이 브라우저에 그대로 노출되므로 절대 넣지 마세요.
window.JORONG_SUPABASE_URL = window.JORONG_SUPABASE_URL || 'https://esjgfxswvtbdbtahlmov.supabase.co';
window.JORONG_SUPABASE_ANON_KEY = window.JORONG_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVzamdmeHN3dnRiZGJ0YWhsbW92Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYzODkyMDAsImV4cCI6MjEwMTk2NTIwMH0.MXmsvdYNwMvO6tCRHsRSlckBJ-HwM6FXMc-Y1uJ4PjI';

// [이전 방식 정리] 예전에는 커스텀 REST 서버 주소(JORONG_API_BASE_URL)를 기준으로 로컬/서버 모드를
// 나눴지만, 지금은 Supabase 프로젝트에 직접 연결하는 방식으로 확정되어 더 이상 사용하지 않습니다.
// (각 서비스 파일은 이제 window.JorongSupabase 존재 여부로 연결 상태를 판단합니다. scripts/supabase-client.js 참고)
window.JORONG_API_BASE_URL = '';
