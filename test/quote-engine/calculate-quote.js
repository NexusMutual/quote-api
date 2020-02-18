const assert = require('assert');
const Big = require('big.js');
const ObjectID = require('mongodb').ObjectID;

const QuoteEngine = require('../../src/quote-engine');
const Stake = require('../../src/models/stake');

const stakeDataMet = require('../fixtures/stakes/threshold-met-date-ok');

function prepareStakes (stakeData) {
  return stakeData.map(data => {
    const stakedAt = new Date(data.stakedAt * 1000);
    const _id = new ObjectID();
    return new Stake({ ...data, _id, stakedAt });
  });
}

describe('calculateQuote()', function () {

  const stakes = prepareStakes(stakeDataMet);

  describe('respects input values and returns correct timestamps', function () {

    const amount = Big('1000');
    const currency = 'DAI';
    const period = 365.25;
    const currencyRate = Big('4000000000000000'); // 1 ETH = 250 DAI
    const nxmPrice = Big('10000000000000000'); // 1 NXM = 0.01 ETH (2.5 DAI)
    const stakedNxm = Big('6000000000000000000000'); // 6000 NXM
    const minCapETH = Big('10000000000000000000000'); // 10000 ETH
    const now = new Date(Date.parse('21 Jan 2020 06:00:00 UTC'));

    const quoteData = QuoteEngine.calculateQuote(
      amount, period, stakes, currency, currencyRate,
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

    const amount = Big('40');
    const currency = 'ETH';
    const period = 365.25;
    const currencyRate = Big('1000000000000000000'); // 1 ETH = 1e18 WEI
    const nxmPrice = Big('10000000000000000'); // 1 NXM = 0.01 ETH (2.5 DAI)
    const stakedNxm = Big('6000000000000000000000'); // 6000 NXM
    const minCapETH = Big('10000000000000000000000'); // 10000 ETH
    const now = new Date(Date.parse('21 Jan 2020 06:00:00 UTC'));

    const quoteData = QuoteEngine.calculateQuote(
      amount, period, stakes, currency, currencyRate,
      nxmPrice, stakedNxm, minCapETH, now,
    );

    const expectedPriceInETH = Big('0.9776').mul('1e18');
    const expectedPriceInNXM = Big('97.76').mul('1e18');

    it('returns the cover price in ETH', function () {
      assert.strict(expectedPriceInETH.eq(quoteData.coverCurrPrice));
    });

    it('returns the cover price in NXM', function () {
      assert.strict(expectedPriceInNXM.eq(quoteData.PriceNxm));
    });
  });

  describe('calculates DAI covers correctly', function () {

    const amount = Big('10000');
    const currency = 'DAI';
    const period = 365.25;
    const currencyRate = Big('4000000000000000'); // 1 ETH = 250 DAI
    const nxmPrice = Big('10000000000000000'); // 1 NXM = 0.01 ETH (2.5 DAI)
    const stakedNxm = Big('6000000000000000000000'); // 6000 NXM
    const minCapETH = Big('10000000000000000000000'); // 10000 ETH
    const now = new Date(Date.parse('21 Jan 2020 06:00:00 UTC'));

    const quoteData = QuoteEngine.calculateQuote(
      amount, period, stakes, currency, currencyRate,
      nxmPrice, stakedNxm, minCapETH, now,
    );

    const expectedPriceInDAI = Big('244.40').mul('1e18');
    const expectedPriceInNXM = Big('97.76').mul('1e18');

    it('returns the cover price in DAI', function () {
      assert.strict(expectedPriceInDAI.eq(quoteData.coverCurrPrice));
    });

    it('returns the cover price in NXM', function () {
      assert.strict(expectedPriceInNXM.eq(quoteData.PriceNxm));
    });
  });

});
