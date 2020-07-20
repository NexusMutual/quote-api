const assert = require('assert');
const Decimal = require('decimal.js');
const ObjectID = require('mongodb').ObjectID;

const QuoteEngine = require('../../src/quote-engine');

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
      assert.strict(quoteData.coverAmount.lte(amount));
    });

    it('returns a cover period equal to the requested period', function () {
      assert.strictEqual(quoteData.coverPeriod, period, 'Returned cover period differs from requested period');
    });

    it('returns the same cover currency', function () {
      assert.strictEqual(quoteData.coverCurrency, currency);
    });

    it('returns correct generation time', function () {
      assert.strictEqual(now.getTime(), quoteData.generationTime);
    });

    it('returns correct expiration time', function () {
      assert.strictEqual(Math.ceil(now.getTime() / 1000 + 3600), quoteData.expireTime);
    });
  });

  describe('calculates ETH covers correctly', function () {

    const amount = Decimal('40');
    const currency = 'ETH';
    const period = 365.25;
    const currencyRate = Decimal('1000000000000000000'); // 1 ETH = 1e18 WEI
    const nxmPrice = Decimal('10000000000000000'); // 1 NXM = 0.01 ETH (2.5 DAI)
    const stakedNxm = Decimal('6000000000000000000000'); // 6000 NXM
    const minCapETH = Decimal('10000000000000000000000'); // 10000 ETH
    const now = new Date(Date.parse('21 Jan 2020 06:00:00 UTC'));

    const quoteData = QuoteEngine.calculateQuote(
      amount, period, currency, currencyRate,
      nxmPrice, stakedNxm, minCapETH, now,
    );

    const expectedPriceInETH = Decimal('0.9776').mul('1e18');
    const expectedPriceInNXM = Decimal('97.76').mul('1e18');

    it('returns the cover price in ETH', function () {
      assert.strict(expectedPriceInETH.eq(quoteData.priceCoverCurrency));
    });

    it('returns the cover price in NXM', function () {
      assert.strict(expectedPriceInNXM.eq(quoteData.priceNxm));
    });
  });

  describe('calculates DAI covers correctly', function () {

    const amount = Decimal('10000');
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

    const expectedPriceInDAI = Decimal('244.40').mul('1e18');
    const expectedPriceInNXM = Decimal('97.76').mul('1e18');

    it('returns the cover price in DAI', function () {
      assert.strict(expectedPriceInDAI.eq(quoteData.priceCoverCurrency));
    });

    it('returns the cover price in NXM', function () {
      assert.strict(expectedPriceInNXM.eq(quoteData.priceNxm));
    });
  });

});
