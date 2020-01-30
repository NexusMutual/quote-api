const assert = require('assert');
const Big = require('big.js');

const utils = require('./utils');
const Stake = require('./models/stake');
const ApiKey = require('./models/api-key');

const ADD_STAKE_SIGNATURE = '6374299e'; // addStake(address,uint256)
const STAKE_EXPIRATION_DAYS = '250';
const MAX_DAYS_SINCE_THRESHOLD_MET = '250';
const MIN_STAKED_THRESHOLD = '1000';
const RISK_COST_EXPONENT = '3';
const LOW_RISK_COST_ETH_LIMIT = '1000';

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
        const amount = Big(parseInt(params[1], 16)).toFixed();
        const stakedAt = new Date(transaction.timeStamp * 1000);
        const blockNumber = parseInt(transaction.blockNumber, 10);
        return { blockNumber, stakerAddress, contractAddress, amount, stakedAt };
      });
  }

  static calculateTotalStakedAmount (stakes, contract) {
    return stakes
      .filter(stake => stake.contractAddress === contract)
      .reduce((sum, stake) => sum.add(stake.amount), Big(0))
      .toFixed();
  }

  /**
   * @param {Stake[]} unsortedStakes
   * @param {number} nxmThreshold
   */
  static calculateThresholdMetDate (unsortedStakes, nxmThreshold) {

    // sort chronologically
    const stakes = unsortedStakes.sort((a, b) => a.stakedAt - b.stakedAt);
    const stakeExpirationDays = parseInt(STAKE_EXPIRATION_DAYS, 10);
    const stakeExpirationInterval = Big(stakeExpirationDays * 24 * 3600 * 1000);
    const threshold = Big(nxmThreshold).mul(1e18);

    for (const referenceStake of stakes) {

      let current = Big(0);

      for (const stake of stakes) {

        const age = Big(referenceStake.stakedAt - stake.stakedAt);

        if (age.gte(stakeExpirationInterval)) {
          continue;
        }

        const originalStakeAmount = Big(stake.amount);
        const timeLeft = stakeExpirationInterval.sub(age);
        const currentStakeAmount = originalStakeAmount.mul(timeLeft).div(stakeExpirationInterval);

        // in-place addition
        current = current.add(currentStakeAmount);

        if (current.gte(threshold)) {
          return stake.stakedAt;
        }

        if (stake._id.equals(referenceStake._id)) {
          // got to present stake
          break;
        }
      }
    }

    return null;
  }

  /**
   * @param {Date} since
   * @param {Date} untill
   * @return {number}
   */
  static calculateDaysDiff (since, untill) {
    const msPerDay = Big(1000 * 3600 * 24); // milliseconds in a day
    const daysSinceMet = Big(untill - since).div(msPerDay).abs();
    return parseInt(daysSinceMet.toFixed(0), 10); // rounding down
  }

  /**
   * Max[
   *   ((250 - Days Since First Staked Threshold has been met) / 250) ^ (RISK_COST_EXPONENT),
   *   MIN_UNSTAKED_RISK_COST
   * ]
   * @param {string} daysSinceThresholdMetString
   * @param {string} riskExponentString
   * @param {string} minUnstakedRisk
   * @return {string} A number between 0 and 1
   */
  static calculateUnstakedRisk (daysSinceThresholdMetString, riskExponentString, minUnstakedRisk) {
    const actualDaysSinceMet = parseInt(daysSinceThresholdMetString, 10);
    const maxDaysSinceMet = parseInt(MAX_DAYS_SINCE_THRESHOLD_MET, 10);

    const boundedDaysSinceMet = Math.min(maxDaysSinceMet, actualDaysSinceMet);
    const ratio = Big(maxDaysSinceMet)
      .minus(boundedDaysSinceMet)
      .div(maxDaysSinceMet);

    const intRiskExponent = parseInt(riskExponentString, 10);
    const calculatedRisk = ratio.pow(intRiskExponent);

    const risk = utils.max(calculatedRisk, minUnstakedRisk);

    return risk.toFixed();
  }

  /**
   * Max[
   *  Min[Unstaked Risk, MAX_STAKED_RISK] x (1 - Staked NXM x NXM PriceETH / LOW_RISK_LIMIT_ETH),
   *  MIN_STAKED_RISK
   * ]
   * @param {string} stakedNxm Number of staked tokens in nxmWei
   * @param {string} nxmPriceEth In wei
   * @param {string} lowRiskEthLimit In wei. Prevents pricing from going to 0 for contracts staked over this limit
   * @param {string} unstakedRisk
   * @param {string} minStakedRisk
   * @param {string} maxStakedRisk
   * @return {string} A number between 0 and 1
   */
  static calculateStakedRisk (
    stakedNxm, nxmPriceEth, lowRiskEthLimit, unstakedRisk, minStakedRisk, maxStakedRisk,
  ) {

    assert(Big(lowRiskEthLimit || 0).gt(0));
    assert(Big(minStakedRisk || 0).gt(0));
    assert(Big(maxStakedRisk || 0).gt(0));

    const stakedNxmEthValue = Big(stakedNxm).mul(nxmPriceEth);
    const stakingToLimitRatio = stakedNxmEthValue.div(lowRiskEthLimit);
    const minRiskMultiplier = utils.min(unstakedRisk, maxStakedRisk);

    const calculatedRisk = Big(1).minus(stakingToLimitRatio).mul(minRiskMultiplier);
    const risk = utils.max(calculatedRisk, minStakedRisk);

    return risk.toFixed();
  }

  // unstakedRiskCost      = Max[ ((250 - Days Since First Staked Threshold has been met) / 250)^(Risk Cost Exponent) , Min Unstaked Risk Cost ]
  // stakedRiskCost        = Max[ Min[Unstaked Risk Cost, Staked High Risk Cost] x (1 - Staked NXM x NXM PriceETH / Low Risk Cost LimitETH), Staked Low Risk Cost]
  // stakedCapacityLimit   = Min[ Staked NXM x NXM PriceETH, Min Cap ETH x Capacity Limit ] x if [ Quote in DAI, NXM PriceDAI, 1 ]
  // unstakedCapacityLimit = if[ Unstaked Risk Cost > 50%, 0 , Min Cap ETH x Capacity Limit ] x if [ Quote in DAI, NXM PriceDAI, 1 ] - Staked Capacity Limit
  // stakedCoverAmount     = Min[ Cover Amount, Staked Capacity Limit ]
  // unStakedCoverAmount   = Min[ Cover Amount - Staked Cover Amount, Unstaked Capacity Limit ]
  // stakedPrice           = Staked Cover Amount x Staked Risk Cost x (1 + Surplus Margin) x Cover Period in Days / 365.25
  // unstakedPrice         = Unstaked Cover Amount x Unstaked Risk Cost x (1 + Surplus Margin) x Cover Period in Days / 365.25
  // totalCover Offered    = Staked Cover Amount + Unstaked Cover Amount
  // totalPrice            = Staked Price + Unstaked Price
  // totalPriceInNXM       = Total Price / if[ quote in DAI, NXM PriceDAI , NXM Price ETH ]

  async getLastBlock () {
    const lastStake = await Stake.findOne().sort({ blockNumber: -1 }).exec();
    return lastStake ? lastStake.blockNumber : 0;
  }

  async getTotalStakedAmount (contract) {
    const stakes = await Stake.find({ contractAddress: contract }).exec();
    return this.constructor.calculateTotalStakedAmount(stakes, contract);
  }

  async fetchNewStakes () {
    const lastBlock = await this.getLastBlock();
    const startBlock = lastBlock + 1;

    console.log(`Fetching transactions starting with ${startBlock}`);
    const watchedContract = this.versionData.address('TF'); // TokenFunctions
    const transactions = await this.etherscan.getTransactions(watchedContract, { startBlock });
    const stakes = this.constructor.parseTransactions(transactions);

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
