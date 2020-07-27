const Decimal = require('decimal.js');

function toLegacyFormatResponse (r, originalAmount) {
  let reason = 'ok';
  if (r.error) {
    reason = 'Uncoverable';
  } else if (r.amount.lt(Decimal(originalAmount))) {
    reason = 'capacityLimitExceed';
  }
  const legacyResponse = {
    coverCurr: r.currency,
    coverPeriod: r.period.toString(),
    smartCA: r.contract,
    coverAmount: parseInt(r.amount.toFixed(0)),
    coverCurrPrice: r.price.toFixed(0),
    PriceNxm: r.priceInNXM.toFixed(0),
    expireTime: r.expiresAt,
    generationTime: r.generatedAt,
    reason,
    v: r.v,
    r: r.r,
    s: r.s,
  };

  return legacyResponse;
}

module.exports = {
  toLegacyFormatResponse,
};
