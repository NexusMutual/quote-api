const utils = require('./utils');
const BN = require('bn.js');

const ADD_STAKE_SIGNATURE = '6374299e';

class QuoteEngine {

  static getStakes (transactions) {
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
        return { stakerAddress, contractAddress, amount, stakedAt };
      });
  }

}

module.exports = QuoteEngine;
