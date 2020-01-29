const assert = require('assert');

const QuoteEngine = require('../../src/quote-engine');

describe('calculateDaysSinceThresholdMet()', function () {

  it('returns correct number of days', function () {
    const metDate = Date.parse('01 Jan 2020 00:00:00 UTC');
    const now = Date.parse('21 Jan 2020 06:00:00 UTC');

    const actual = QuoteEngine.calculateDaysSinceThresholdMet(metDate, now);
    const expected = 20;

    assert.strictEqual(actual, expected);
  });

});
