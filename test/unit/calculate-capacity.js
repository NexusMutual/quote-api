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

    const activeCovers = [
      { sumAssured: Decimal('200'), currency: 'ETH' },
      { sumAssured: Decimal('100').mul(ethDAIRate), currency: 'DAI' },
    ];
    const currencyRates = {
      ETH: Decimal('1e18'),
      DAI: Decimal('1e18').div(ethDAIRate),
    };
    const capacityFactor = Decimal('1');
    const capacity = QuoteEngine.calculateCapacity(
      stakedNxm, nxmPrice, minCapETH, activeCovers, currencyRates, capacityFactor
    );
    assert.strictEqual(to2Decimals(capacity), '1760.09');
  });
});
