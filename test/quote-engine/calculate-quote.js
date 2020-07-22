const assert = require('assert');
const Decimal = require('decimal.js');

const QuoteEngine = require('../../src/quote-engine');

function to2Decimals (weiValue) {
  return weiValue.div('1e18').toDecimalPlaces(2).toFixed();
}

describe('calculateQuote()', function () {
  describe('respects input values and returns correct timestamps', function () {

    const amount = Decimal('1000');
    const currency = 'DAI';
    const period = 365.25;
    const currencyRate = Decimal('4000000000000000'); // 1 ETH = 250 DAI
    const nxmPrice = Decimal('10000000000000000'); // 1 NXM = 0.01 ETH (2.5 DAI)
    const stakedNxm = Decimal('6000000000000000000000'); // 6000 NXM
    const minCapETH = Decimal('10000000000000000000000'); // 10000 ETH
    const now = new Date(Date.parse('21 Jan 2020 06:00:00 UTC'));

    const quoteData = QuoteEngine.calculateQuote(
      amount, period, currency, currencyRate,
      nxmPrice, stakedNxm, minCapETH, now,
    );

    it('returns a cover amount less or equal to the requested amount', function () {
      assert.strict(quoteData.amount.lte(amount));
    });

    it('returns a cover period equal to the requested period', function () {
      assert.strictEqual(quoteData.period, period, 'Returned cover period differs from requested period');
    });

    it('returns the same cover currency', function () {
      assert.strictEqual(quoteData.currency, currency);
    });

    it('returns correct generation time', function () {
      assert.strictEqual(now.getTime(), quoteData.generatedAt);
    });

    it('returns correct expiration time', function () {
      assert.strictEqual(Math.ceil(now.getTime() / 1000 + 3600), quoteData.expiresAt);
    });
  });

  describe('calculates ETH covers correctly', function () {

    const ethDAIRate = Decimal(233);
    const nxmPriceDAI = Decimal(4).mul('1e18');
    const nxmPrice = nxmPriceDAI.div(ethDAIRate);
    const minCapETH = Decimal(13500).mul('1e18');
    const now = new Date(Date.parse('21 Jan 2020 06:00:00 UTC'));
    const currencyRate = Decimal('1e18');
    const currency = 'ETH';

    function assertETHAndNXMPrices (amount, period, stakedNxm, expectedPriceInETH, expectedPriceInNXM, expectedCoverAmountOffered) {

      const quoteData = QuoteEngine.calculateQuote(
        amount, period, currency, currencyRate,
        nxmPrice, stakedNxm, minCapETH, now,
      );
      assert.equal(
        to2Decimals(quoteData.price),
        to2Decimals(expectedPriceInETH),
      );
      assert.equal(
        to2Decimals(quoteData.priceInNXM),
        to2Decimals(expectedPriceInNXM),
      );
      assert.equal(
        to2Decimals(quoteData.amount),
        to2Decimals(expectedCoverAmountOffered),
      );
    }

    it('returns the cover price in ETH and NXM for 1000 cover', function () {
      const amount = Decimal('1000');
      const period = 365.25;
      const stakedNxm = Decimal(120000).mul('1e18');
      const expectedPriceInETH = Decimal('91.49').mul('1e18');
      const expectedPriceInNXM = Decimal('5329.22').mul('1e18');
      const expectedCoverAmountOffered = amount;
      assertETHAndNXMPrices(amount, period, stakedNxm, expectedPriceInETH, expectedPriceInNXM, expectedCoverAmountOffered);
    });

    it('returns the cover price in ETH and NXM for 230 cover', function () {
      const amount = Decimal('230');
      const period = 100;
      const stakedNxm = Decimal(240000).mul('1e18');
      const expectedPriceInETH = Decimal('0.82').mul('1e18');
      const expectedPriceInNXM = Decimal('47.68').mul('1e18');
      const expectedCoverAmountOffered = amount;
      assertETHAndNXMPrices(amount, period, stakedNxm, expectedPriceInETH, expectedPriceInNXM, expectedCoverAmountOffered);
    });

    it('returns the cover price in ETH and NXM for 5000 cover exceeding global capacity', function () {
      const amount = Decimal('5000');
      const period = 365.25;
      const stakedNxm = Decimal(220000).mul('1e18');
      const expectedPriceInETH = Decimal('35.10').mul('1e18');
      const expectedPriceInNXM = Decimal('2044.58').mul('1e18');
      const expectedCoverAmountOffered = Decimal('2700');
      assertETHAndNXMPrices(amount, period, stakedNxm, expectedPriceInETH, expectedPriceInNXM, expectedCoverAmountOffered);
    });

    it(`returns 'uncoverable' for 0 stake`, function () {
      const amount = Decimal('1000');
      const period = 365.25;
      const stakedNxm = Decimal(0);
      const quoteData = QuoteEngine.calculateQuote(
        amount, period, currency, currencyRate,
        nxmPrice, stakedNxm, minCapETH, now,
      );
      assert.equal(quoteData.error, 'Uncoverable');
    });
  });

  describe('calculates DAI covers correctly', function () {

    const ethDAIRate = Decimal(233);
    const nxmPriceDAI = Decimal(4).mul('1e18');
    const nxmPrice = nxmPriceDAI.div(ethDAIRate);
    const minCapETH = Decimal(13500).mul('1e18');
    const now = new Date(Date.parse('21 Jan 2020 06:00:00 UTC'));
    const currencyRate = Decimal('1e18').div(ethDAIRate);
    const currency = 'DAI';

    function assertETHAndNXMPrices (amount, period, stakedNxm, expectedPriceInETH, expectedPriceInNXM, expectedCoverAmountOffered) {

      const quoteData = QuoteEngine.calculateQuote(
        amount, period, currency, currencyRate,
        nxmPrice, stakedNxm, minCapETH, now,
      );
      assert.equal(
        to2Decimals(quoteData.price),
        to2Decimals(expectedPriceInETH),
      );
      assert.equal(
        to2Decimals(quoteData.priceInNXM),
        to2Decimals(expectedPriceInNXM),
      );
      assert.equal(
        to2Decimals(quoteData.amount),
        to2Decimals(expectedCoverAmountOffered),
      );
    }

    it('returns the cover price in DAI and NXM for 800000 cover exceeding global capacity', function () {
      const amount = Decimal('800000');
      const period = 365.25;
      const stakedNxm = Decimal('180000').mul('1e18');
      const expectedPriceInDAI = Decimal('12217.39').mul('1e18');
      const expectedPriceInNXM = Decimal('3054.35').mul('1e18');
      const expectedCoverAmountOffered = Decimal('629100');
      assertETHAndNXMPrices(amount, period, stakedNxm, expectedPriceInDAI, expectedPriceInNXM, expectedCoverAmountOffered);
    });

    it('returns the cover price in DAI and NXM for 50000 cover', function () {
      const amount = Decimal('50000');
      const period = 365.25;
      const stakedNxm = Decimal('40000').mul('1e18');
      const expectedPriceInDAI = Decimal('13351.17').mul('1e18');
      const expectedPriceInNXM = Decimal('3337.79').mul('1e18');
      const expectedCoverAmountOffered = amount;
      assertETHAndNXMPrices(amount, period, stakedNxm, expectedPriceInDAI, expectedPriceInNXM, expectedCoverAmountOffered);
    });

    it('returns the cover price in DAI and NXM for 150000 cover exceeding staking capacity limit', function () {
      const amount = Decimal('150000');
      const period = 100;
      const stakedNxm = Decimal('20000').mul('1e18');
      const expectedPriceInDAI = Decimal('7981.57').mul('1e18');
      const expectedPriceInNXM = Decimal('1995.39').mul('1e18');
      const expectedCoverAmountOffered = Decimal('80000');
      assertETHAndNXMPrices(amount, period, stakedNxm, expectedPriceInDAI, expectedPriceInNXM, expectedCoverAmountOffered);
    });
  });

});
