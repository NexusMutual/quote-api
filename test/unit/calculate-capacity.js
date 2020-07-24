const assert = require('assert');
const Decimal = require('decimal.js');
const { to2Decimals } = require('./testing-utils');
const QuoteEngine = require('../../src/quote-engine');
const ActiveCover = require('../../src/active-cover');

describe('calculateCapacity()', function () {
  it('calculates capacity correctly', function () {
    const stakedNxm = Decimal(120000).mul('1e18');
    const ethDAIRate = Decimal(233);
    const nxmPriceDAI = Decimal(4).mul('1e18');
    const nxmPrice = nxmPriceDAI.div(ethDAIRate);
    const minCapETH = Decimal(13500).mul('1e18');

    const activeCovers = [
      new ActiveCover('', '200', 'ETH'),
      new ActiveCover('', Decimal('100').mul(ethDAIRate), 'DAI'),
    ];
    const currencyRates = {
      ETH: Decimal('1e18'),
      DAI: Decimal('1e18').div(ethDAIRate),
    };
    const capacity = QuoteEngine.calculateCapacity(stakedNxm, nxmPrice, minCapETH, activeCovers, currencyRates);
    assert.strictEqual(to2Decimals(capacity), '1760.09');
  });
});
