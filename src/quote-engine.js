const assert = require('assert');
const Big = require('big.js');
const web3 = require('web3');

const utils = require('./utils');
const Stake = require('./models/stake');
const ApiKey = require('./models/api-key');

const ADD_STAKE_SIGNATURE = '6374299e'; // addStake(address,uint256)
const STAKE_EXPIRATION_DAYS = '250';
const MAX_DAYS_SINCE_THRESHOLD_MET = '250';
const DAYS_PER_YEAR = '365.25';
const MIN_STAKED_THRESHOLD = '1000';
const RISK_COST_EXPONENT = '3';
const LOW_RISK_COST_ETH_LIMIT = '1000';
const CONTRACT_CAPACITY_LIMIT_PERCENT = '0.2';
const HIGH_RISK_THRESHOLD = '0.5';
const MIN_UNSTAKED_RISK = '0.02';
const MIN_STAKED_RISK = '0.01';
const MAX_STAKED_RISK_MULTIPLIER = '0.1';
const COVER_PRICE_SURPLUS_MARGIN = '0.3';

class QuoteEngine {

  /**
   * @param {Etherscan} etherscan
   * @param {VersionData} versionData
   */
  constructor (etherscan, versionData) {
    this.etherscan = etherscan;
    this.versionData = versionData;
  }

  /**
   * Parses transaction list in format returned by etherscan
   * Returns data as array of stake data objects
   *
   * @param transactions
   * @return {Object[]}
   */
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
   * @param {string} nxmWeiThreshold
   */
  static calculateThresholdMetDate (unsortedStakes, nxmWeiThreshold) {

    // sort chronologically
    const stakes = unsortedStakes.sort((a, b) => a.stakedAt - b.stakedAt);
    const stakeExpirationDays = parseInt(STAKE_EXPIRATION_DAYS, 10);
    const stakeExpirationInterval = Big(stakeExpirationDays * 24 * 3600 * 1000);

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

        if (current.gte(nxmWeiThreshold)) {
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
   *  Min[Unstaked Risk, MAX_STAKED_RISK] x (1 - Staked NXM x NXM PriceETH / LOW_RISK_LIMIT_ETH),
   *  MIN_STAKED_RISK
   * ]
   *
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

  /**
   * Max[
   *   ((250 - Days Since First Staked Threshold has been met) / 250) ^ (RISK_COST_EXPONENT),
   *   MIN_UNSTAKED_RISK_COST
   * ]
   *
   * @param {Number} daysSinceThresholdMet
   * @param {Number} riskExponent
   * @param {string} minUnstakedRisk
   * @return {string} A number between 0 and 1
   */
  static calculateUnstakedRisk (daysSinceThresholdMet, riskExponent, minUnstakedRisk) {
    const maxDaysSinceMet = parseInt(MAX_DAYS_SINCE_THRESHOLD_MET, 10);
    const boundedDaysSinceMet = Math.min(maxDaysSinceMet, daysSinceThresholdMet);

    const ratio = Big(maxDaysSinceMet)
      .minus(boundedDaysSinceMet)
      .div(maxDaysSinceMet);

    const calculatedRisk = ratio.pow(riskExponent);
    const risk = utils.max(calculatedRisk, minUnstakedRisk);

    return risk.toFixed();
  }

  /**
   * Min [Staked NXM x NXM PriceETH, maxCapacityPerContract]
   *
   * @param {Big} stakedNxm
   * @param {Big} nxmPriceEth
   * @param {Big} maxCapacityPerContract
   * @return {Big}
   */
  static calculateStakedCapacity (stakedNxm, nxmPriceEth, maxCapacityPerContract) {
    const stakedNxmEthValue = Big(stakedNxm).mul(nxmPriceEth);
    return utils.min(stakedNxmEthValue, maxCapacityPerContract);
  }

  /**
   * if [Unstaked Risk Cost > 50%, 0 , maxCapacityPerContract] - Staked Capacity
   *
   * @param {string} unstakedRisk A value between 0 and 1
   * @param {Big} maxUnstakedRisk
   * @param {Big} maxCapacityPerContract Max available capacity for a contract in ETH
   * @param {Big} stakedCapacity Staked capacity in ETH
   * @return {Big}
   */
  static calculateUnstakedCapacity (unstakedRisk, maxUnstakedRisk, maxCapacityPerContract, stakedCapacity) {
    const isHighRisk = Big(unstakedRisk).gt(maxUnstakedRisk);
    return isHighRisk ? Big(0) : maxCapacityPerContract.sub(stakedCapacity);
  }

  /**
   * Used for staked and unstaked price calculation (the formula is identical)
   *
   * Cover Amount x Staked Risk Cost x (1 + Surplus Margin) x Cover Period in Days / 365.25
   *
   * @param {Big} coverAmount
   * @param {string} risk A number between 0 and 1
   * @param {string} surplusMargin A number to calculate the multiplier (ex 0.3 for 30%)
   * @param {number} coverPeriod Cover period in days (integer)
   * @return {Big}
   */
  static calculatePrice (coverAmount, risk, surplusMargin, coverPeriod) {
    const surplusMultiplier = Big(surplusMargin).add(1);
    const pricePerDay = coverAmount
      .mul(risk)
      .mul(surplusMultiplier)
      .div(DAYS_PER_YEAR);

    return pricePerDay.mul(coverPeriod);
  }

  /**
   * Fetches total staked NXM on a smart contract
   *
   * @param {string} contractAddress
   * @return {Big} Staked NXM amount as big.js instance
   */
  async getStakedNxm (contractAddress) {
    const tokenFunctions = this.versionData.instance('TF');
    const staked = await tokenFunctions.methods.getTotalStakedTokensOnSmartContract(contractAddress).call();
    return Big(staked);
  }

  /**
   * Fetches NXM token price in ETH
   *
   * @return {Big}
   */
  async getTokenPrice () {
    const tokenFunctions = this.versionData.instance('TF');
    const currency = web3.utils.fromAscii('ETH');
    const price = await tokenFunctions.methods.getTokenPrice(currency).call();
    return Big(price);
  }

  /**
   * Fetches mcrEther from last posted MCR
   *
   * @return {Big}
   */
  async getLastMcrEth () {
    const poolData = this.versionData.instance('PD');
    const mcrEth = await poolData.methods.getLastMCREther().call();
    return Big(mcrEth);
  }

  /**
   * Fetches DAI price in wei from Chainlink
   * @return {Big}
   */
  async getDaiRate () {
    const chainlinkAggregator = this.versionData.instance('CHAINLINK-DAI-ETH');
    const daiRate = await chainlinkAggregator.methods.latestAnswer().call();
    return Big(daiRate);
  }

  async getCurrencyRate (currency) {

    if (currency === 'ETH') {
      return '1';
    }

    if (currency === 'DAI') {
      return this.getDaiRate();
    }

    throw new Error(`Unsupported currency ${currency}`);
  }

  /**
   * @param {Big} reqCoverAmount
   * @param {number} coverPeriod
   * @param {Stake[]} stakes
   * @param {String} coverCurrency
   * @param {Big} coverCurrencyRate
   * @param {Big} nxmPrice
   * @param {Big} stakedNxm
   * @param {Big} minCapETH
   * @return {object|null}
   */
  static calculateQuote (
    reqCoverAmount,
    coverPeriod,
    stakes,
    coverCurrency,
    coverCurrencyRate,
    nxmPrice,
    stakedNxm,
    minCapETH,
  ) {

    const generationTime = Date.now();
    const expireTime = Math.ceil(generationTime / 1000 + 3600);

    const minStakedThreshold = Big(MIN_STAKED_THRESHOLD).mul(1e18).toFixed(); // nxmWei
    const thresholdMetDate = QuoteEngine.calculateThresholdMetDate(stakes, minStakedThreshold);

    if (thresholdMetDate === null) {
      return {
        reason: 'uncoverable: not enough staking',
        generationTime,
        expireTime,
      }
    }

    const daysSinceThresholdMet = QuoteEngine.calculateDaysDiff(thresholdMetDate, generationTime);

    const riskCostExponent = parseInt(RISK_COST_EXPONENT, 10);
    const lowRiskLimit = Big(LOW_RISK_COST_ETH_LIMIT).mul(1e18).toFixed(); // in wei

    const unstakedRisk = QuoteEngine.calculateUnstakedRisk(daysSinceThresholdMet,riskCostExponent, MIN_UNSTAKED_RISK);
    const stakedRisk = QuoteEngine.calculateStakedRisk(
      stakedNxm.toFixed(),
      nxmPrice.toFixed(),
      lowRiskLimit,
      unstakedRisk,
      MIN_STAKED_RISK,
      MAX_STAKED_RISK_MULTIPLIER,
    );

    const maxCapacityPerContract = minCapETH.mul(CONTRACT_CAPACITY_LIMIT_PERCENT).mul(1e18); // in wei
    const stakedCapacity = QuoteEngine.calculateStakedCapacity(stakedNxm, nxmPrice, maxCapacityPerContract);

    const maxUnstakedRisk = Big(HIGH_RISK_THRESHOLD);
    const unstakedCapacity = QuoteEngine.calculateUnstakedCapacity(
      unstakedRisk,
      maxUnstakedRisk,
      maxCapacityPerContract,
      stakedCapacity,
    );

    const requestedCoverAmountInWei = reqCoverAmount.mul(coverCurrencyRate).mul(1e18);
    const stakedCoverAmount = utils.min(requestedCoverAmountInWei, stakedCapacity);
    const unstakedCoverAmount = (stakedCoverAmount >= requestedCoverAmountInWei)
      ? 0
      : utils.min(requestedCoverAmountInWei.sub(stakedCoverAmount), unstakedCapacity);

    const surplusMargin = COVER_PRICE_SURPLUS_MARGIN;
    const stakedPrice = QuoteEngine.calculatePrice(stakedCoverAmount, stakedRisk, surplusMargin, coverPeriod);
    const unstakedPrice = QuoteEngine.calculatePrice(unstakedCoverAmount, unstakedRisk, surplusMargin, coverPeriod);

    const quotePriceInWei = stakedPrice.add(unstakedPrice);
    const quotePriceInCoverCurrencyWei = quotePriceInWei.mul(coverCurrencyRate);
    const quotePriceInNxmWei = quotePriceInWei.mul(nxmPrice);

    const totalCoverOffered = stakedCoverAmount.add(unstakedCoverAmount);
    const totalCoverInCoverCurrency = totalCoverOffered.mul(coverCurrencyRate);

    return {
      coverCurrency,
      coverPeriod,
      coverAmount: totalCoverInCoverCurrency.div(1e18),
      coverCurrPrice: quotePriceInCoverCurrencyWei.div(1e18).toFixed(0),
      PriceNxm: quotePriceInNxmWei,
      reason: 'ok',
      expireTime,
      generationTime,
    };
  }

  /**
   * @param {object} quote
   * @return {{ v: number, r: string, s: string }}
   */
  static signQuote (quote) {
    return {
      v: 28,
      r: '0x40298ef06ce874b75d051d7821aad6e9889a5f49133e6cf0e178ac7af6696f53',
      s: '0x50cccb76d5efc43a305cd953b094a59c0833191e08ced59d3dc058068f32bf46',
    };
  }

  /**
   * @param {string} contractAddress
   * @param {string} reqCoverAmount Requested cover amount (might differ from offered cover amount)
   * @param {string} currency
   * @param {string} reqPeriod
   * @return {object|null}
   */
  async getQuote (contractAddress, reqCoverAmount, currency, reqPeriod) {

    const amount = Big(reqCoverAmount);
    const period = parseInt(reqPeriod, 10);

    const stakes = await Stake.find({ contractAddress });
    console.log(`Found ${stakes.length} stakes for the contract`);

    const currencyRate = await this.getCurrencyRate(currency); // ETH amount for 1 unit of the currency
    const nxmPrice = await this.getTokenPrice(); // ETH amount for 1 unit of the currency

    const stakedNxm = await this.getStakedNxm(contractAddress);
    const minCapETH = await this.getLastMcrEth();

    const quoteData = QuoteEngine.calculateQuote(
      amount,
      period,
      stakes,
      currency,
      currencyRate,
      nxmPrice,
      stakedNxm,
      minCapETH,
    );
    const unsignedQuote = { ...quoteData, coverCurr: currency, smartCA: contractAddress };
    const signature = QuoteEngine.signQuote(unsignedQuote);

    return {
      ...unsignedQuote,
      ...signature,
    };
  }

  // stakedRisk             = Max[ Min[Unstaked Risk Cost, Staked High Risk Cost] x (1 - Staked NXM x NXM PriceETH / Low Risk Cost LimitETH), Staked Low Risk Cost]
  // unstakedRisk           = Max[ ((250 - Days Since First Staked Threshold has been met) / 250)^(Risk Cost Exponent) , Min Unstaked Risk ]

  // maxCapacityPerContract = Min Cap ETH x Capacity Limit

  // stakedCapacity         = Min[ Staked NXM x NXM PriceETH, maxCapacityPerContract ]
  // unstakedCapacity       = if[ Unstaked Risk Cost > 50%, 0 , maxCapacityPerContract ] - Staked Capacity

  // stakedCoverAmount      = Min[ Cover Amount, Staked Capacity ]
  // unstakedCoverAmount    = Min[ Cover Amount - Staked Cover Amount, Unstaked Capacity ]

  // stakedPrice            = Staked Cover Amount x Staked Risk Cost x (1 + Surplus Margin) x Cover Period in Days / 365.25
  // unstakedPrice          = Unstaked Cover Amount x Unstaked Risk Cost x (1 + Surplus Margin) x Cover Period in Days / 365.25

  // totalCover Offered     = Staked Cover Amount + Unstaked Cover Amount
  // quoteTotalPrice        = Staked Price + Unstaked Price
  // totalPriceInNXM        = Total Price / if[ quote in DAI, NXM PriceDAI , NXM Price ETH ]

  async getLastBlock () {
    const lastStake = await Stake.findOne().sort({ blockNumber: -1 });
    return lastStake ? lastStake.blockNumber : 0;
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
}

module.exports = QuoteEngine;
