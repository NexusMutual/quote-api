const assert = require('assert');
const Decimal = require('decimal.js');
const ObjectID = require('mongodb').ObjectID;

const QuoteEngine = require('../../src/quote-engine');

function to2Decimals(weiValue) {
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

    const ethDAIRate = Decimal(233);
    const nxmPriceDAI = Decimal(4).mul('1e18');
    const nxmPrice = nxmPriceDAI.div(ethDAIRate);
    const minCapETH = Decimal(13500).mul('1e18');
    const now = new Date(Date.parse('21 Jan 2020 06:00:00 UTC'));
    const currencyRate = Decimal('1e18');
    const currency = 'ETH';

    function assertETHAndNXMPrices(amount, period, stakedNxm, expectedPriceInETH, expectedPriceInNXM) {

      const quoteData = QuoteEngine.calculateQuote(
        amount, period, currency, currencyRate,
        nxmPrice, stakedNxm, minCapETH, now,
      );
      assert.equal(
        to2Decimals(quoteData.priceCoverCurrency),
        to2Decimals(expectedPriceInETH)
      );
      assert.equal(
        to2Decimals(quoteData.priceNxm),
        to2Decimals(expectedPriceInNXM)
      );
    }

    it('returns the cover price in ETH and NXM for 1000 cover', function () {
      const amount = Decimal('1000');
      const period = 365.25;
      const stakedNxm = Decimal(120000).mul('1e18');
      const expectedPriceInETH = Decimal('91.49').mul('1e18');
      const expectedPriceInNXM = Decimal('5329.22').mul('1e18');
      assertETHAndNXMPrices(amount, period, stakedNxm, expectedPriceInETH, expectedPriceInNXM);
    });

    it('returns the cover price in ETH and NXM for 230 cover', function () {
      const amount = Decimal('230');
      const period = 100;
      const stakedNxm = Decimal(240000).mul('1e18');
      const expectedPriceInETH = Decimal('0.82').mul('1e18');
      const expectedPriceInNXM = Decimal('47.68').mul('1e18');
      assertETHAndNXMPrices(amount, period, stakedNxm, expectedPriceInETH, expectedPriceInNXM);
    })

    it('returns the cover price in ETH and NXM for 5000 cover exceeding global capacity', function () {
      const amount = Decimal('5000');
      const period = 365.25;
      const stakedNxm = Decimal(220000).mul('1e18');
      const expectedPriceInETH = Decimal('35.10').mul('1e18');
      const expectedPriceInNXM = Decimal('2044.58').mul('1e18');
      assertETHAndNXMPrices(amount, period, stakedNxm, expectedPriceInETH, expectedPriceInNXM);
    });
  });
  //
  // describe('calculates DAI covers correctly', function () {
  //
  //   const amount = Decimal('10000');
  //   const currency = 'DAI';
  //   const period = 365.25;
  //   const currencyRate = Decimal('4000000000000000'); // 1 ETH = 250 DAI
  //   const nxmPrice = Decimal('10000000000000000'); // 1 NXM = 0.01 ETH (2.5 DAI)
  //   const stakedNxm = Decimal('6000000000000000000000'); // 6000 NXM
  //   const minCapETH = Decimal('10000000000000000000000'); // 10000 ETH
  //   const now = new Date(Date.parse('21 Jan 2020 06:00:00 UTC'));
  //
  //   const quoteData = QuoteEngine.calculateQuote(
  //     amount, period, currency, currencyRate,
  //     nxmPrice, stakedNxm, minCapETH, now,
  //   );
  //
  //   const expectedPriceInDAI = Decimal('244.40').mul('1e18');
  //   const expectedPriceInNXM = Decimal('97.76').mul('1e18');
  //
  //   it('returns the cover price in DAI', function () {
  //     assert.strict(expectedPriceInDAI.eq(quoteData.priceCoverCurrency));
  //   });
  //
  //   it('returns the cover price in NXM', function () {
  //     assert.strict(expectedPriceInNXM.eq(quoteData.priceNxm));
  //   });
  // });

});
