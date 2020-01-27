const assert = require('assert');

const QuoteEngine = require('../../src/quote-engine');
const stakesFixture = require('../fixtures/stakes');

describe('getStakes()', function () {

  it('correctly calculates total staked amount for each contract', async function () {
    const stakes = stakesFixture.map(stake => ({ ...stake, stakedAt: new Date(stake.stakedAt * 1000) }));
    const expected = {
      '0x1fd169a4f5c59acf79d0fd5d91d1201ef1bce9f1': '1000000000000000000000',
      '0x448a5065aebb8e423f0896e6c5d525c040f59af3': '23000000000000000000',
      '0x2c4bd064b998838076fa341a83d007fc2fa50957': '5000000000000000000',
    };

    for (const contract of Object.keys(expected)) {
      const actual = QuoteEngine.getTotalStakedAmount(stakes, contract);
      assert.strictEqual(actual, expected[contract]);
    }
  });

  it('returns 0 if the contracts does not exist', async function () {
    const stakes = stakesFixture.map(stake => ({ ...stake, stakedAt: new Date(stake.stakedAt * 1000) }));
    const actual = QuoteEngine.getTotalStakedAmount(stakes, '0xdeadbeef');
    const expected = '0';
    assert.strictEqual(actual, expected);
  });

});
