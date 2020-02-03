const assert = require('assert');
const ObjectID = require('mongodb').ObjectID;

const QuoteEngine = require('../../src/quote-engine');
const Stake = require('../../src/models/stake');

const stakeDataMet = require('../fixtures/stakes/threshold-met-date-ok');
const stakeDataNotMet = require('../fixtures/stakes/threshold-met-date-not-met');

function prepareStakes (stakeData) {
  return stakeData.map(data => {
    const stakedAt = new Date(data.stakedAt * 1000);
    const _id = new ObjectID();
    return new Stake({ ...data, _id, stakedAt });
  });
}

describe('calculateThresholdMetDate()', function () {

  it('returns null when there are no stakes', function () {
    const expected = null;
    const threshold = (100 * 1e18).toFixed();
    const actual = QuoteEngine.calculateThresholdMetDate([], threshold);
    assert.deepStrictEqual(actual, expected);
  });

  it('takes into account stake expiration', function () {
    const stakes = prepareStakes(stakeDataNotMet);
    const threshold = (1000 * 1e18).toFixed();
    const actual = QuoteEngine.calculateThresholdMetDate(stakes, threshold);
    const expected = null;
    assert.strictEqual(actual, expected);
  });

  it('returns the date when the threshold was met', function () {
    const stakes = prepareStakes(stakeDataMet);
    const threshold = (1000 * 1e18).toFixed();
    const date = QuoteEngine.calculateThresholdMetDate(stakes, threshold);
    assert.notStrictEqual(date, null);

    const actual = date.getTime();
    const expected = stakes[2].stakedAt.getTime();
    assert.deepStrictEqual(actual, expected);
  });

});
