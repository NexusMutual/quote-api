const BN = require('bn.js');
const utils = require('./utils');
const Stake = require('./models/stake');

const ADD_STAKE_SIGNATURE = '6374299e';

class QuoteEngine {

  constructor (etherscan) {
    this.etherscan = etherscan;
  }

  static parseTransactions (transactions) {
    return transactions
      .filter(transaction => transaction.isError === '0') // filter out failed transactions
      .map(transaction => {
        const fn = transaction.input.slice(2, 10);
        const params = utils.wrap(transaction.input.slice(10), 64);
        return { ...transaction, fn, params };
      })
      .filter(transaction => transaction.fn === ADD_STAKE_SIGNATURE) // only addStake function
      .map(transaction => {
        const { from: stakerAddress, params } = transaction;
        const contractAddress = '0x' + params[0].slice(24);
        const amount = new BN(params[1], 16).toString();
        const stakedAt = new Date(transaction.timeStamp * 1000);
        const blockNumber = parseInt(transaction.blockNumber, 10);
        return { blockNumber, stakerAddress, contractAddress, amount, stakedAt };
      });
  }

  static getTotalStakedAmount (stakes, contract) {
    return stakes
      .filter(stake => stake.contractAddress === contract)
      .reduce((sum, stake) => sum.add(new BN(stake.amount)), new BN(0))
      .toString();
  }

  async getLastBlock () {
    throw new Error('Untested');
    const lastStake = await Stake.findOne().sort({ blockNumber: -1 }).exec();
    return lastStake ? lastStake.blockNumber : 0;
  }

  async fetchNewStakes () {
    throw new Error('Untested');
    const lastBlock = await this.getLastBlock();
    const startBlock = lastBlock + 1;

    console.log(`Fetching transactions starting with ${startBlock}`);
    const transactions = await this.etherscan.getTransactions('', { startBlock });
    const stakes = QuoteEngine.parseTransactions(transactions);

    console.log(`Found ${stakes.length} new stakes`);
    Stake.insertMany(stakes);
  }

}

module.exports = QuoteEngine;
