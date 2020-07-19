const Big = require('big.js');
const ethABI = require('ethereumjs-abi');
const util = require('ethereumjs-util');
const utils = require('./utils');
const { hex } = require('./utils');
const BN = require('bn.js');


const DAYS_PER_YEAR = '365.25';
const CONTRACT_CAPACITY_LIMIT_PERCENT = '0.2';
const COVER_PRICE_SURPLUS_MARGIN = '0.3';


class QuoteEngine {
  /**
   * @param {Etherscan} etherscan
   * @param {VersionData} versionData
   */
  constructor (nexusContractLoader, privateKey) {
    this.nexusContractLoader = nexusContractLoader;
    this.privateKey = privateKey;
  }

  /**
   * Min [Staked NXM x NXM PriceETH, maxCapacityPerContract]
   *
   * @param {Big} stakedNxm
   * @param {Big} nxmPriceEth
   * @param {Big} maxCapacityPerContract
   * @return {Big}
   */
  static calculateCapacity (stakedNxm, nxmPriceEth, maxCapacityPerContract) {
    const stakedNxmEthValue = Big(stakedNxm).mul(nxmPriceEth);
    return utils.min(stakedNxmEthValue, maxCapacityPerContract);
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
    const pooledStaking = this.nexusContractLoader.instance('PS');
    const staked = await pooledStaking.contractStake(contractAddress);
    return staked;
  }

  /**
   * Fetches NXM token price in ETH
   *
   * @return {Big}
   */
  async getTokenPrice () {
    const tokenFunctions = this.nexusContractLoader.instance('TF');
    const price = await tokenFunctions.getTokenPrice(hex('ETH'));
    return Big(price);
  }

  /**
   * Fetches mcrEther from last posted MCR
   *
   * @return {Big}
   */
  async getLastMcrEth () {
    const poolData = this.nexusContractLoader.instance('PD');
    const mcrEth = await poolData.getLastMCREther();
    return mcrEth;
  }

  /**
   * Fetches DAI price in wei from Chainlink
   * @return {Big}
   */
  async getDaiRate () {
    const chainlinkAggregator = this.nexusContractLoader.instance('CHAINLINK-DAI-ETH');
    const daiRate = await chainlinkAggregator.latestAnswer().call();
    return Big(daiRate);
  }

  /**
   * Returns amount of ether wei for 1 currency unit
   * @param {string} currency
   * @return {Promise<string|Big>}
   */
  async getCurrencyRate (currency) {

    if (currency === 'ETH') {
      return '1e18';
    }

    if (currency === 'DAI') {
      return this.getDaiRate();
    }

    throw new Error(`Unsupported currency ${currency}`);
  }

  /**
   *
   * @param {object} quote
   * @param {string} quotationContractAddress
   * @return {{ v: number, r: string, s: string }}
   */
  static signQuote (quote, quotationContractAddress, privateKeyString) {
    const currency = '0x' + Buffer.from(quotationData.coverCurrency, 'utf8').toString('hex');
    const orderParts = [
      { value: bigNumberToBN(quotationData.coverAmount), type: 'uint' },
      { value: currency, type: 'bytes4' },
      { value: bigNumberToBN(quotationData.coverPeriod), type: 'uint16' },
      { value: quotationData.contractAddress, type: 'address' },
      { value: bigNumberToBN(quotationData.priceCoverCurrency.toFixed()), type: 'uint' },
      { value: bigNumberToBN(quotationData.priceNxm.toFixed()), type: 'uint' },
      { value: bigNumberToBN(quotationData.expireTime), type: 'uint' },
      { value: bigNumberToBN(quotationData.generationTime), type: 'uint' },
      { value: quotationContractAddress, type: 'address' },
    ];

    const types = orderParts.map(o => o.type);
    const values = orderParts.map(o => o.value);
    const message = ethABI.soliditySHA3(types, values);
    const msgHash = util.hashPersonalMessage(message);
    const privateKey = Buffer.from(privateKeyString, 'hex');
    const sig = util.ecsign(msgHash, privateKey);
    return {
      v: sig.v,
      r: sig.r,
      s: sig.s
    };
  }

  /**
   * @param {Big} requestedCoverAmount Amount user wants to cover in cover currency, ex: 100
   * @param {number} coverPeriod Cover period in days
   * @param {String} coverCurrency Ex: "ETH" or "DAI"
   * @param {Big} coverCurrencyRate Amount of wei for 1 cover currency unit
   * @param {Big} nxmPrice Amount of wei for 1 NXM
   * @param {Big} stakedNxm
   * @param {Big} minCapETH
   * @param {Date} now
   *
   * @typedef {{
   *   reason: string,
   *   generationTime: number,
   *   expireTime: number,
   * }} QuoteUncoverable
   *
   * @typedef {{
   *     reason: string,
   *     generationTime: number,
   *     expireTime: number,
   *     coverCurrency: string,
   *     coverPeriod: number,
   *     coverAmount: Big,
   *     priceCoverCurrency: Big,
   *     priceNxm: Big,
   * }} QuoteCoverable
   *
   * @return {QuoteCoverable|QuoteUncoverable|null}
   */
  static computeQuote (
    requestedCoverAmount,
    coverPeriod,
    coverCurrency,
    coverCurrencyRate,
    nxmPrice,
    stakedNxm,
    minCapETH,
    now,
  ) {
    const generationTime = now.getTime();
    const expireTime = Math.ceil(generationTime / 1000 + 3600);

    const maxGlobalCapacityPerContract = minCapETH.mul(CONTRACT_CAPACITY_LIMIT_PERCENT).mul('1e18'); // in wei
    const maxCapacity = QuoteEngine.calculateCapacity(stakedNxm, nxmPrice, maxGlobalCapacityPerContract);

    const requestedCoverAmountInWei = requestedCoverAmount.mul(coverCurrencyRate);
    // limit cover amount by maxCapacity
    const finalCoverAmountInWei = utils.min(maxCapacity, requestedCoverAmountInWei);

    const risk = this.computeRisk(stakedNxm, finalCoverAmountInWei, maxGlobalCapacityPerContract);

    const surplusMargin = COVER_PRICE_SURPLUS_MARGIN;
    const quotePriceInWei = QuoteEngine.calculatePrice(finalCoverAmountInWei, risk, surplusMargin, coverPeriod);

    const quotePriceInCoverCurrencyWei = quotePriceInWei.div(coverCurrencyRate).mul('1e18');
    const quotePriceInNxmWei = quotePriceInWei.div(nxmPrice).mul('1e18');
    const finalCoverInCoverCurrency = finalCoverAmountInWei.div(coverCurrencyRate);

    return {
      coverCurrency,
      coverPeriod,
      coverAmount: finalCoverInCoverCurrency.toFixed(0),
      priceCoverCurrency: quotePriceInCoverCurrencyWei.toFixed(6),
      priceNxm: quotePriceInNxmWei.toFixed(0),
      reason: 'ok',
      expireTime,
      generationTime,
    };
  }

  static computeRisk(stakedNxm) {
    const STAKED_HIGH_RISK_COST = Big(100);
    const LOW_RISK_COST_LIMIT_NXM = Big(2e5);
    const PRICING_EXPONENT = Big(7);
    const STAKED_LOW_RISK_COST = Big(1);
    // uncappedRiskCost = stakedHighRiskCost * [1 - netStakedNXM/lowRiskCostLimit ^ (1/pricingExponent) ];
    const exponent = Big(1).div(PRICING_EXPONENT);
    let uncappedRiskCost = STAKED_HIGH_RISK_COST.mul(Big(1).sub(stakedNxm.div(LOW_RISK_COST_LIMIT_NXM).pow(exponent)));
    const riskCost = utils.max(STAKED_LOW_RISK_COST, uncappedRiskCost);
    return riskCost;
  }

  /**
   * @param {string} contractAddress
   * @param {string} coverAmount Requested cover amount (might differ from offered cover amount)
   * @param {string} currency
   * @param {string} reqPeriod
   * @return {object|null}
   */
  async getQuote (contractAddress, coverAmount, currency, reqPeriod) {
    const amount = Big(coverAmount);
    const period = parseInt(reqPeriod, 10);
    const now = new Date();
    const currencyRate = await this.getCurrencyRate(currency); // ETH amount for 1 unit of the currency
    const nxmPrice = await this.getTokenPrice(); // ETH amount for 1 unit of the currency

    const stakedNxm = await this.getStakedNxm(contractAddress);
    const minCapETH = await this.getLastMcrEth();

    const quoteData = QuoteEngine.computeQuote(
      amount,
      period,
      currency,
      currencyRate,
      nxmPrice,
      stakedNxm,
      minCapETH,
      now,
    );
    const unsignedQuote = { ...quoteData, coverCurrency: currency, contractAddress };
    const signature = QuoteEngine.signQuote(unsignedQuote, this.privateKey);

    return {
      ...unsignedQuote,
      ...signature,
    };
  }
}

function bigNumberToBN (value) {
  return new BN(value.round().toString());
}


module.exports = QuoteEngine;
