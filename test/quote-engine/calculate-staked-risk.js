const assert = require('assert');
const Big = require('big.js');

const QuoteEngine = require('../../src/quote-engine');

describe('calculateStakedRisk()', function () {

  it('returns minimum staked risk if staked nxm is over the provided eth limit', function () {

    const stakedNxm = Big(128000).mul(1e18).toFixed();
    const nxmPriceEth = '15625000000000000'; // (2.5 $/NXM) / (160 $/ETH) = 0.015625 ETH/NXM
    const lowRiskEthLimit = Big(1000).mul(1e18).toFixed();
    const unstakedRisk = '0.2';
    const minStakedRisk = '0.01';
    const maxStakedRisk = '0.1';

    const expected = '0.01';
    const actual = QuoteEngine.calculateStakedRisk(
      stakedNxm, nxmPriceEth, lowRiskEthLimit,
      unstakedRisk, minStakedRisk, maxStakedRisk,
    );

    assert.strictEqual(actual, expected);
  });

  it('returns calculated staked risk if staked nxm is under the provided eth limit', function () {

    const stakedNxm = Big(32000).mul(1e18).toFixed(); // 500 ETH
    const nxmPriceEth = '15625000000000000'; // (2.5 $/NXM) / (160 $/ETH) = 0.015625 ETH/NXM
    const lowRiskEthLimit = Big(1000).mul(1e18).toFixed();
    const unstakedRisk = '0.2';
    const minStakedRisk = '0.01';
    const maxStakedRisk = '0.1';

    const expected = '0.05';
    const actual = QuoteEngine.calculateStakedRisk(
      stakedNxm, nxmPriceEth, lowRiskEthLimit,
      unstakedRisk, minStakedRisk, maxStakedRisk,
    );

    assert.strictEqual(actual, expected);
  });

  it('uses the unstaked risk as a multiplier if it is lower than max staked risk', function () {

    const stakedNxm = Big(6400).mul(1e18).toFixed(); // 100 ETH
    const nxmPriceEth = '15625000000000000'; // (2.5 $/NXM) / (160 $/ETH) = 0.015625 ETH/NXM
    const lowRiskEthLimit = Big(1000).mul(1e18).toFixed();
    const unstakedRisk = '0.05';
    const minStakedRisk = '0.01';
    const maxStakedRisk = '0.1';

    const expected = '0.045';
    const actual = QuoteEngine.calculateStakedRisk(
      stakedNxm, nxmPriceEth, lowRiskEthLimit,
      unstakedRisk, minStakedRisk, maxStakedRisk,
    );

    assert.strictEqual(actual, expected);
  });

  describe('fails if constants are not set', function () {

    const stakedNxm = '';
    const nxmPriceEth = '0';
    const lowRiskEthLimit = '0';
    const unstakedRisk = '0';
    const minStakedRisk = '0';
    const maxStakedRisk = '0';
    const badValues = [undefined, '', null, 0, '0', false];

    it('unset eth limit', function () {
      for (const badLimit of badValues) {
        let caught;
        try {
          QuoteEngine.calculateStakedRisk(
            stakedNxm, nxmPriceEth, badLimit,
            unstakedRisk, minStakedRisk, maxStakedRisk,
          );
        } catch (thrown) {
          caught = thrown;
        }
        assert.strict(caught instanceof assert.AssertionError);
      }
    });

    it('unset min staked risk', function () {
      for (const badMinStakedRisk of badValues) {
        let caught;
        try {
          QuoteEngine.calculateStakedRisk(
            stakedNxm, nxmPriceEth, lowRiskEthLimit,
            unstakedRisk, badMinStakedRisk, maxStakedRisk,
          );
        } catch (thrown) {
          caught = thrown;
        }
        assert.strict(caught instanceof assert.AssertionError);
      }
    });

    it('unset max staked risk', function () {
      for (const badMaxStakedRisk of badValues) {
        let caught;
        try {
          QuoteEngine.calculateStakedRisk(
            stakedNxm, nxmPriceEth, lowRiskEthLimit,
            unstakedRisk, minStakedRisk, badMaxStakedRisk,
          );
        } catch (thrown) {
          caught = thrown;
        }
        assert.strict(caught instanceof assert.AssertionError);
      }
    });

  });

});
