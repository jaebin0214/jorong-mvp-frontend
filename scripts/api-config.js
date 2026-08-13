// [Supabase 연결 설정] 아래 두 값을 채우면 서비스 파일들이 로컬 모의 데이터 대신 실제 Supabase를 사용합니다.
// 값은 Supabase 대시보드 → Settings → API에서 복사 (anon key는 노출돼도 안전 — RLS가 방어).
window.JORONG_SUPABASE_URL = 'https://<프로젝트ID>.supabase.co';
window.JORONG_SUPABASE_ANON_KEY = '<anon key>';

// index.html에 아래 스크립트가 이 파일보다 먼저 로드되어 있어야 합니다.
// <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js"></script>
window.SupabaseClient = (window.JORONG_SUPABASE_URL && window.JORONG_SUPABASE_ANON_KEY && window.supabase)
  ? window.supabase.createClient(window.JORONG_SUPABASE_URL, window.JORONG_SUPABASE_ANON_KEY)
  : null;

// [오늘의 종목 1개 조회] "종목 1개" 운영 방침에 따라, 진행 중(status='trading')인 종목을 하나만 가져와 캐시합니다.
// 백엔드 스키마는 여러 종목을 지원하지만, 운영진이 매주 이 한 종목만 'trading' 상태로 열면 이 방식이 그대로 맞습니다.
// ⚠️ 실수로 'trading' 상태 종목이 2개 이상 열리면 가장 최근(id가 큰) 것 하나만 사용합니다 — 운영 시 항상 1개만 열려 있는지 확인 필요.
let activeStockPromise = null;
window.getActiveStock = function getActiveStock({ force = false } = {}) {
  if (!window.SupabaseClient) return Promise.reject(new Error('Supabase 클라이언트가 설정되지 않았습니다.'));
  if (force) activeStockPromise = null;
  if (!activeStockPromise) {
    activeStockPromise = window.SupabaseClient
      .from('stocks')
      .select('*')
      .eq('status', 'trading')
      .order('id', { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data, error }) => {
        if (error) throw new Error(error.message);
        if (!data) throw new Error('진행 중인 종목이 없습니다.');
        return data;
      });
  }
  return activeStockPromise;
};
