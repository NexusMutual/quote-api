const assert = require('assert');

const QuoteEngine = require('../../src/quote-engine');

describe('calculateUnstakedRiskCost()', function () {

  it('returns minUnstakedRiskCost if calculated risk cost is smaller', function () {
    const daysSinceThresholdMet = 300;
    const exponent = 3;
    const minUnstakedRiskCost = '0.02';
    const actual = QuoteEngine.calculateUnstakedRiskCost(daysSinceThresholdMet, exponent, minUnstakedRiskCost);
    assert.strictEqual(actual, minUnstakedRiskCost);
  });

  it('correctly calculates risk cost', function () {
    const daysSinceThresholdMet = 200;
    const exponent = 3;
    const minUnstakedRiskCost = '0';

    const actual = QuoteEngine.calculateUnstakedRiskCost(daysSinceThresholdMet, exponent, minUnstakedRiskCost);
    const expected = '0.008';

    assert.strictEqual(actual, expected);
  });

});
