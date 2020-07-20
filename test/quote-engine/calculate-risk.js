const assert = require('assert');
const Decimal = require('decimal.js');

const QuoteEngine = require('../../src/quote-engine');

describe('calculateRisk()', function () {

  it('calculates risk value correctly', function () {
    const inputAndExpected = [
      [1000, '53.09'],
      [2501, '46.52'],
      [5001, '40.96'],
      [7501, '37.44'],
      [10001, '34.82'],
      [15001, '30.93'],
      [22501, '26.81'],
      [32501, '22.86'],
      [60001, '15.8'],
      [60001, '15.8'],
      [77501, '12.67'],
      [97501, '9.75'],
      [110001, '8.19']
    ];
    for (const [stakedNXM, expectedRisk] of inputAndExpected) {
      const risk = QuoteEngine.calculateRisk(Decimal(stakedNXM).mul(1e18));
      assert.equal(risk.toDecimalPlaces(2).toString(), expectedRisk, `Failed for stakedNXM=${stakedNXM}`);
    }
  });
});
