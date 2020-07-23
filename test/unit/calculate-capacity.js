const assert = require('assert');
const Decimal = require('decimal.js');
const { to2Decimals } = require('./testing-utils');
const QuoteEngine = require('../../src/quote-engine');

describe('calculateCapacity()', function () {
  it('calculates capacity correctly', function () {
    const stakedNxm = Decimal(120000).mul('1e18');
    const ethDAIRate = Decimal(233);
    const nxmPriceDAI = Decimal(4).mul('1e18');
    const nxmPrice = nxmPriceDAI.div(ethDAIRate);
    const minCapETH = Decimal(13500).mul('1e18');

    const capacity = QuoteEngine.calculateCapacity(stakedNxm, nxmPrice, minCapETH);
    assert.equal(to2Decimals(capacity), '2060.09');
  });
});
