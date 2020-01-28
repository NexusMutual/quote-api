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

describe.only('getThresholdMetDate()', function () {

  it('returns null when there are no stakes', function () {
    const expected = null;
    const actual = QuoteEngine.getThresholdMetDate([], 100);
    assert.deepStrictEqual(actual, expected);
  });

  it('takes into account stake expiration', function () {
    const stakes = prepareStakes(stakeDataNotMet);
    const actual = QuoteEngine.getThresholdMetDate(stakes, 1000);
    const expected = null;
    assert.strictEqual(actual, expected);
  });

  it('returns the date when the threshold was met', function () {
    const stakes = prepareStakes(stakeDataMet);
    const date = QuoteEngine.getThresholdMetDate(stakes, 1000);
    assert.notStrictEqual(date, null);

    const actual = date.getTime();
    const expected = stakes[2].stakedAt.getTime();
    assert.deepStrictEqual(actual, expected);
  });

});
