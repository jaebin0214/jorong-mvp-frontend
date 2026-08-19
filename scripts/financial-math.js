// [고정밀 투자 계산] JavaScript Number 대신 BigInt 고정소수점으로 수량·평균 단가·손익을 계산합니다.
// 실제 운영에서는 서버 DB의 NUMERIC/DECIMAL 계산이 최종 기준이며, 이 모듈은 화면 표시·로컬 시연용으로만 사용합니다.
window.FinancialMath = (() => {
  const PRICE_DECIMALS = 8;
  const QUANTITY_DECIMALS = 12;
  const PNL_DECIMALS = 8;
  const RATE_DECIMALS = 8;
  const PRICE_SCALE = 10n ** BigInt(PRICE_DECIMALS);
  const QUANTITY_SCALE = 10n ** BigInt(QUANTITY_DECIMALS);
  const PNL_SCALE = 10n ** BigInt(PNL_DECIMALS);
  const RATE_SCALE = 10n ** BigInt(RATE_DECIMALS);

  function createError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
  }

  // [문자열 → 고정소수점] API가 보내는 숫자 문자열도 정확히 읽어 부동소수점 오차를 피합니다.
  function parseDecimal(value, decimals) {
    const source = String(value ?? '').trim();
    if (!/^[+-]?\d+(?:\.\d+)?$/.test(source)) throw createError('INVALID_DECIMAL', '유효하지 않은 숫자입니다.');
    const sign = source.startsWith('-') ? -1n : 1n;
    const unsigned = source.replace(/^[+-]/, '');
    const [integerPart, fractionPart = ''] = unsigned.split('.');
    const scale = 10n ** BigInt(decimals);
    const fraction = `${fractionPart}${'0'.repeat(decimals)}`.slice(0, decimals);
    return sign * ((BigInt(integerPart) * scale) + BigInt(fraction || '0'));
  }

  function absolute(value) {
    return value < 0n ? -value : value;
  }

  // [ROUND_HALF_UP] 금액 표시와 지급액은 0.5 이상을 절대값 기준으로 올립니다.
  function divideRoundHalfUp(numerator, denominator) {
    if (denominator === 0n) throw createError('DIVIDE_BY_ZERO', '0으로 나눌 수 없습니다.');
    const sign = (numerator < 0n) !== (denominator < 0n) ? -1n : 1n;
    const top = absolute(numerator);
    const bottom = absolute(denominator);
    const quotient = top / bottom;
    const remainder = top % bottom;
    return sign * (quotient + (remainder * 2n >= bottom ? 1n : 0n));
  }

  function toDecimalString(value, decimals, { trim = true } = {}) {
    const sign = value < 0n ? '-' : '';
    if (decimals === 0) return `${sign}${absolute(value).toString()}`;
    const source = absolute(value).toString().padStart(decimals + 1, '0');
    const integerPart = source.slice(0, -decimals) || '0';
    const fractionPart = source.slice(-decimals);
    const fraction = trim ? fractionPart.replace(/0+$/, '') : fractionPart;
    return `${sign}${integerPart}${fraction ? `.${fraction}` : ''}`;
  }

  function normalizeSide(side) {
    const normalized = String(side || '').toUpperCase();
    if (normalized === 'ROAST') return 'MOCK'; // 이전 MVP에서 쓰던 값과의 호환성입니다.
    if (normalized === 'SUPPORT' || normalized === 'MOCK') return normalized;
    throw createError('INVALID_SIDE', '옹호 또는 조롱 의견을 선택해주세요.');
  }

  function parseInvestment(value) {
    if (!/^\d+$/.test(String(value ?? '').trim())) throw createError('INVALID_AMOUNT', '투자금은 1 크레딧 이상의 정수여야 합니다.');
    const amount = BigInt(String(value));
    if (amount <= 0n) throw createError('INVALID_AMOUNT', '투자금은 1 크레딧 이상이어야 합니다.');
    return amount;
  }

  // [가격 그대로 파싱] 화면 표시·손익 계산에 쓰는 "진짜" 가격입니다. 2026-08-19부로 서버
  // 가격(current_price)이 마이너스여도 거래가 계속되도록 바뀌어서, 더 이상 여기서 양수 여부를
  // 검증하지 않습니다(검증하면 마이너스 가격 종목에서 화면 전체가 죽습니다 — 실제로 겪은 버그:
  // "추가 투자" 패널을 열 때 calculateMetrics가 던진 INVALID_EXECUTION_PRICE로 전체가 멈춤).
  function parsePrice(value) {
    return parseDecimal(value, PRICE_DECIMALS);
  }

  // [나눗셈 전용] 수량(quantity) = 투자금 ÷ 가격 을 계산할 때만 쓰는 분모입니다. 서버
  // place_order()의 v_qty_divisor := greatest(execution_price, 1)과 동일하게, 가격이 1 이하
  // (0·마이너스 포함)면 1로 바닥을 깝니다 — 그래야 수량이 항상 양수로 남고 0으로 나누는
  // 사고도 나지 않습니다. 실제 체결가 표시에는 이 값이 아니라 parsePrice()를 씁니다.
  function priceDivisor(value) {
    const price = parseDecimal(value, PRICE_DECIMALS);
    return price > PRICE_SCALE ? price : PRICE_SCALE;
  }

  // [추가 수량] amount / executionPrice를 수량 소수점 12자리로 반올림해 보관합니다.
  function calculateAddedQuantity(investmentAmount, executionPrice) {
    const amount = parseInvestment(investmentAmount);
    const divisor = priceDivisor(executionPrice);
    const quantity = divideRoundHalfUp(amount * PRICE_SCALE * QUANTITY_SCALE, divisor);
    return toDecimalString(quantity, QUANTITY_DECIMALS);
  }

  // [가중평균] 총 투자금과 총 보유 수량을 기준으로 평균 단가를 다시 계산합니다.
  function calculatePositionAfterOrder({ position = null, side, investmentAmount, executionPrice }) {
    const normalizedSide = normalizeSide(side);
    if (position?.side && normalizeSide(position.side) !== normalizedSide) {
      throw createError('POSITION_LOCKED', '한 번 선택한 의견은 장 종료까지 변경할 수 없습니다.');
    }

    const oldInvestment = position ? parseInvestment(position.totalInvestment) : 0n;
    const oldQuantity = position ? parseDecimal(position.quantity, QUANTITY_DECIMALS) : 0n;
    const additionalInvestment = parseInvestment(investmentAmount);
    const price = parsePrice(executionPrice);
    const divisor = priceDivisor(executionPrice);
    const addedQuantity = divideRoundHalfUp(additionalInvestment * PRICE_SCALE * QUANTITY_SCALE, divisor);
    const totalInvestment = oldInvestment + additionalInvestment;
    const quantity = oldQuantity + addedQuantity;
    const averagePrice = divideRoundHalfUp(totalInvestment * QUANTITY_SCALE * PRICE_SCALE, quantity);

    return {
      side: normalizedSide,
      totalInvestment: totalInvestment.toString(),
      quantity: toDecimalString(quantity, QUANTITY_DECIMALS),
      averagePrice: toDecimalString(averagePrice, PRICE_DECIMALS),
      addedQuantity: toDecimalString(addedQuantity, QUANTITY_DECIMALS),
      executionPrice: toDecimalString(price, PRICE_DECIMALS),
      status: 'OPEN',
    };
  }

  // [평가손익] 방향 × (현재가 - 평균 단가) × 보유 수량을 손익 소수점 8자리로 보존합니다.
  function calculateMetrics({ position, currentPrice }) {
    if (!position) return null;
    const side = normalizeSide(position.side);
    const totalInvestment = parseInvestment(position.totalInvestment);
    const quantity = parseDecimal(position.quantity, QUANTITY_DECIMALS);
    const averagePrice = parsePrice(position.averagePrice);
    const current = parsePrice(currentPrice);
    const direction = side === 'SUPPORT' ? 1n : -1n;
    const pnl = divideRoundHalfUp(
      direction * (current - averagePrice) * quantity * PNL_SCALE,
      PRICE_SCALE * QUANTITY_SCALE,
    );
    const pnlRate = totalInvestment > 0n
      ? divideRoundHalfUp(pnl * 100n * RATE_SCALE, PNL_SCALE * totalInvestment)
      : 0n;
    const estimatedSettlementAmount = totalInvestment * PNL_SCALE + pnl;

    return {
      side,
      currentPrice: toDecimalString(current, PRICE_DECIMALS),
      totalInvestment: totalInvestment.toString(),
      quantity: toDecimalString(quantity, QUANTITY_DECIMALS),
      averagePrice: toDecimalString(averagePrice, PRICE_DECIMALS),
      unrealizedPnl: toDecimalString(pnl, PNL_DECIMALS),
      pnlRate: toDecimalString(pnlRate, RATE_DECIMALS),
      estimatedSettlementAmount: toDecimalString(estimatedSettlementAmount > 0n ? estimatedSettlementAmount : 0n, PNL_DECIMALS),
    };
  }

  function calculateSettlement({ position, closePrice, balanceBeforeSettlement }) {
    const metrics = calculateMetrics({ position, currentPrice: closePrice });
    if (!metrics) return null;
    const settlementAmount = parseDecimal(metrics.estimatedSettlementAmount, PNL_DECIMALS);
    const balanceBefore = parseInvestment(balanceBeforeSettlement);
    return {
      ...metrics,
      closePrice: metrics.currentPrice,
      realizedPnl: metrics.unrealizedPnl,
      settlementAmount: toDecimalString(settlementAmount, PNL_DECIMALS),
      balanceAfterSettlement: (balanceBefore + divideRoundHalfUp(settlementAmount, PNL_SCALE)).toString(),
      status: 'SETTLED',
    };
  }

  function roundToInteger(value, decimals) {
    return divideRoundHalfUp(parseDecimal(value, decimals), 10n ** BigInt(decimals));
  }

  // [화면 금액 표기] 계산 값은 그대로 두고 서비스 내 통화 명칭만 크레딧으로 표시합니다.
  function formatCredits(value, decimals = PNL_DECIMALS) {
    const rounded = roundToInteger(value, decimals);
    const sign = rounded > 0n ? '+' : rounded < 0n ? '-' : '';
    return `${sign}${absolute(rounded).toLocaleString('ko-KR')} 크레딧`;
  }

  function formatCreditsUnsigned(value, decimals = PNL_DECIMALS) {
    const rounded = roundToInteger(value, decimals);
    return `${absolute(rounded).toLocaleString('ko-KR')} 크레딧`;
  }

  function formatPrice(value) {
    const scaled = parseDecimal(value, PRICE_DECIMALS);
    const roundedToTwo = divideRoundHalfUp(scaled, 10n ** BigInt(PRICE_DECIMALS - 2));
    const sign = roundedToTwo < 0n ? '-' : '';
    const source = absolute(roundedToTwo).toString().padStart(3, '0');
    const integerPart = source.slice(0, -2);
    const fractionPart = source.slice(-2).replace(/0+$/, '');
    // Number 변환 없이 BigInt 정수부를 묶어 20자리 가격도 정확히 표시합니다.
    return `${sign}${BigInt(integerPart).toLocaleString('ko-KR')}${fractionPart ? `.${fractionPart}` : ''} 크레딧`;
  }

  function formatQuantity(value) {
    const scaled = parseDecimal(value, QUANTITY_DECIMALS);
    const roundedToFour = divideRoundHalfUp(scaled, 10n ** BigInt(QUANTITY_DECIMALS - 4));
    return `${toDecimalString(roundedToFour, 4, { trim:false })}주`;
  }

  function formatRate(value) {
    const scaled = parseDecimal(value, RATE_DECIMALS);
    const roundedToTwo = divideRoundHalfUp(scaled, 10n ** BigInt(RATE_DECIMALS - 2));
    const sign = roundedToTwo > 0n ? '+' : '';
    return `${sign}${toDecimalString(roundedToTwo, 2, { trim:false })}%`;
  }

  return Object.freeze({
    PRICE_DECIMALS,
    QUANTITY_DECIMALS,
    PNL_DECIMALS,
    RATE_DECIMALS,
    createError,
    normalizeSide,
    calculateAddedQuantity,
    calculatePositionAfterOrder,
    calculateMetrics,
    calculateSettlement,
    formatCredits,
    formatCreditsUnsigned,
    formatPrice,
    formatQuantity,
    formatRate,
  });
})();
