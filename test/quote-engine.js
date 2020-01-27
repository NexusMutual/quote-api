const assert = require('assert');

const QuoteEngine = require('../src/quote-engine');
const transactions = require('./fixtures/transactions');

describe('quote-engine', function () {
  describe('getStakes()', function () {
    describe('single stake', function () {

      const [stake] = QuoteEngine.getStakes(transactions.SINGLE_STAKE);

      it('properly gets staker address', async function () {
        const expected = '0x87b2a7559d85f4653f13e6546a14189cd5455d45';
        assert.deepStrictEqual(stake.stakerAddress, expected);
      });

      it('properly gets contract address', async function () {
        const expected = '0x1fd169a4f5c59acf79d0fd5d91d1201ef1bce9f1';
        assert.deepStrictEqual(stake.contractAddress, expected);
      });

      it('properly gets stake amount', async function () {
        const expected = '1000000000000000000000';
        assert.deepStrictEqual(stake.amount, expected);
      });

      it('properly gets staking date', async function () {
        const expected = 1558784772000;
        assert.deepStrictEqual(stake.stakedAt.getTime(), expected);
      });
    });
  });
});
