const assert = require('assert');

const QuoteEngine = require('../../src/quote-engine');
const transactions = require('../fixtures/transactions');

describe('parseTransactions()', function () {

  it('skips failed transactions', async function () {
    const stakes = QuoteEngine.parseTransactions(transactions.FAILED_TRANSACTIONS);
    assert.deepStrictEqual(stakes, []);
  });

  it('skips functions with different signatures', async function () {
    const stakes = QuoteEngine.parseTransactions(transactions.DIFFERENT_SIGNATURE);
    assert.deepStrictEqual(stakes, []);
  });

  const stakes = QuoteEngine.parseTransactions(transactions.MULTIPLE_TRANSACTIONS);

  it('returns blockNumber, stakerAddress, contractAddress, amount, and stakedAt', async function () {
    for (const stake of stakes) {
      const actual = Object.keys(stake).sort();
      const expected = ['blockNumber', 'stakerAddress', 'contractAddress', 'amount', 'stakedAt'].sort();
      assert.deepStrictEqual(actual, expected);
    }
  });

  it('properly gets staker addresses', async function () {
    const actual = stakes.map(stake => stake.stakerAddress);
    const expected = [
      '0x87b2a7559d85f4653f13e6546a14189cd5455d45',
      '0x7a16c1b3ed3a72776f65a16de2e58576e3acb1cc',
      '0xb9e5436ccbc77b8c25a3fdb53273cfde1e85990a',
      '0xb9e5436ccbc77b8c25a3fdb53273cfde1e85990a',
      '0x959ad4a87a4039109f9133ab110787679f6d1038',
    ];
    assert.deepStrictEqual(actual, expected);
  });

  it('properly gets contract addresses', async function () {
    const actual = stakes.map(stake => stake.contractAddress);
    const expected = [
      '0x1fd169a4f5c59acf79d0fd5d91d1201ef1bce9f1',
      '0x448a5065aebb8e423f0896e6c5d525c040f59af3',
      '0x448a5065aebb8e423f0896e6c5d525c040f59af3',
      '0x2c4bd064b998838076fa341a83d007fc2fa50957',
      '0x448a5065aebb8e423f0896e6c5d525c040f59af3',
    ];
    assert.deepStrictEqual(actual, expected);
  });

  it('properly gets stake amounts', async function () {
    const actual = stakes.map(stake => stake.amount);
    const expected = [
      '1000000000000000000000',
      '9000000000000000000',
      '5000000000000000000',
      '5000000000000000000',
      '9000000000000000000',
    ];
    assert.deepStrictEqual(actual, expected);
  });

  it('properly gets staking dates', async function () {
    const actual = stakes.map(stake => stake.stakedAt.getTime());
    const expected = [1558784772000, 1558809281000, 1558816355000, 1558816894000, 1558878290000];
    assert.deepStrictEqual(actual, expected);
  });

  it('properly gets block numbers', async function () {
    const actual = stakes.map(stake => stake.blockNumber);
    const expected = [7828588, 7830443, 7830973, 7831009, 7835575];
    assert.deepStrictEqual(actual, expected);
  });
});
