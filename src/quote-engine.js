const BN = require('bn.js');
const utils = require('./utils');
const Stake = require('./models/stake');
const ApiKey = require('./models/stake');

const ADD_STAKE_SIGNATURE = '6374299e'; // addStake(address,uint256)

class QuoteEngine {

  /**
   * @param {Etherscan} etherscan
   * @param {VersionData} versionData
   */
  constructor (etherscan, versionData) {
    this.etherscan = etherscan;
    this.versionData = versionData;
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

  static calculateTotalStakedAmount (stakes, contract) {
    return stakes
      .filter(stake => stake.contractAddress === contract)
      .reduce((sum, stake) => sum.add(new BN(stake.amount)), new BN(0))
      .toString();
  }

  async getLastBlock () {
    const lastStake = await Stake.findOne().sort({ blockNumber: -1 }).exec();
    return lastStake ? lastStake.blockNumber : 0;
  }

  async getTotalStakedAmount (contract) {
    const stakes = await Stake.find({ contractAddress: contract }).exec();
    return QuoteEngine.calculateTotalStakedAmount(stakes, contract);
  }

  async fetchNewStakes () {
    const lastBlock = await this.getLastBlock();
    const startBlock = lastBlock + 1;

    console.log(`Fetching transactions starting with ${startBlock}`);
    const watchedContract = this.versionData.address('TF'); // TokenFunctions
    const transactions = await this.etherscan.getTransactions(watchedContract, { startBlock });
    const stakes = QuoteEngine.parseTransactions(transactions);

    console.log(`Found ${stakes.length} new stakes`);
    Stake.insertMany(stakes);
  }

  async isOriginAllowed (origin, apiKey) {

    if (/\.nexusmutual\.io$/.test(origin)) {
      return true;
    }

    if (!apiKey) { // null, undefined, etc
      return false;
    }

    apiKey = await ApiKey.findOne({ origin, apiKey });

    return apiKey !== null;
  }

  async getQuote (contractAddress, coverAmount, currency, period) {
    return {
      coverCurr: currency,
      coverPeriod: period,
      smartCA: contractAddress,
      coverAmount,
      reason: 'ok',
      expireTime: 1580222069,
      generationTime: 1580218469674,
      coverCurrPrice: 1542322610000000,
      PriceNxm: '103511584563758380',
      v: 28,
      r: '0x40298ef06ce874b75d051d7821aad6e9889a5f49133e6cf0e178ac7af6696f53',
      s: '0x50cccb76d5efc43a305cd953b094a59c0833191e08ced59d3dc058068f32bf46',
    };

  }
}

module.exports = QuoteEngine;
