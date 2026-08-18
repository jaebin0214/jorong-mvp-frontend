# 조롱 거래소 실시간 그래프 백엔드 확인 요청

안녕하세요. 조롱 거래소 실시간 그래프 관련 확인 요청드립니다.

현재 프론트엔드는 Supabase의 `get_market_candles` 기능을 통해 시장별 캔들 데이터를 받아 그래프를 그리고 있습니다.

현재 확인된 응답 형식 자체는 정상입니다. 다만 전달받은 캔들 가격 데이터에서 가격 흐름이 자연스럽게 이어지지 않는 문제가 확인되었습니다.

예를 들면 이전 캔들의 종가가 `850`인데, 다음 캔들의 시작 가격이 `1,100`으로 전달되고 있습니다. 투자 주문만으로 가격이 변하는 구조라면 다음 캔들의 시작 가격은 이전 캔들의 종가와 같아야 합니다.

## 확인 요청 사항

1. `get_market_candles` RPC가 현재 배포된 Supabase 프로젝트에 정상적으로 존재하는지 확인 부탁드립니다.

2. RPC가 아래 구조로 데이터를 반환하는지 확인 부탁드립니다.

```text
candles 안에
startedAt
endedAt
open
high
low
close
volume
```

3. 캔들 가격 계산 규칙이 아래처럼 적용되는지 확인 부탁드립니다.

```text
첫 번째 캔들의 open = 종목 최초 가격

다음 캔들의 open = 이전 캔들의 close

high = 해당 1분 동안 가장 높았던 가격
low = 해당 1분 동안 가장 낮았던 가격
close = 해당 1분 동안 마지막 주문 이후의 가격
volume = 해당 1분 동안 투자된 금액의 합계
```

4. 주문이 없는 시간에는 가격이 바뀌지 않도록 처리되는지 확인 부탁드립니다.

주문이 없으면 이전 가격을 그대로 유지하고 거래량은 `0`이어야 합니다.

5. 같은 시간에 여러 주문이 들어오면 주문 생성 시간 순서대로 가격이 계산되는지 확인 부탁드립니다.

`created_at` 기준으로 순서가 보장되어야 합니다.

6. 시장의 현재 가격(`markets.current_price`)과 마지막 캔들의 종가(`close`)가 일치하는지 확인 부탁드립니다.

현재 프론트에서는 서버가 전달하는 가격 데이터를 그대로 그래프로 표시하고 있습니다. 그래서 서버에서 `850 → 1,100 → 650 → 400 → 150`처럼 비연속적인 가격이 전달되면 그래프도 그 흐름대로 이상하게 나타납니다.

## Supabase SQL Editor 확인 쿼리

아래 세 가지를 확인해주시면 원인 파악에 도움이 됩니다.

```sql
select *
from public.price_candles
where market_session_id = '4'
order by started_at asc;
```

```sql
select *
from public.investment_orders
where market_id = '4'
order by created_at asc, id asc;
```

```sql
select public.get_market_candles(
  p_market_id := '4',
  p_interval_seconds := 60
);
```

확인 결과나 조회된 데이터가 있으면 전달 부탁드립니다. 프론트에서 그래프 표시 방식과 함께 다시 대조해보겠습니다.
