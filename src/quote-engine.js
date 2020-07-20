const Decimal = require('decimal.js');
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
   * @param {Decimal} stakedNxm
   * @param {Decimal} nxmPriceEth
   * @param {Decimal} maxCapacityPerContract
   * @return {Decimal}
   */
  static calculateCapacity (stakedNxm, nxmPriceEth, maxCapacityPerContract) {
    const stakedNxmEthValue = Decimal(stakedNxm).mul(nxmPriceEth);
    return utils.min(stakedNxmEthValue, maxCapacityPerContract);
  }

  /**
   * Used for staked and unstaked price calculation (the formula is identical)
   *
   * Cover Amount x Staked Risk Cost x (1 + Surplus Margin) x Cover Period in Days / 365.25
   *
   * @param {Decimal} coverAmount
   * @param {string} risk A number between 0 and 1
   * @param {string} surplusMargin A number to calculate the multiplier (ex 0.3 for 30%)
   * @param {number} coverPeriod Cover period in days (integer)
   * @return {Decimal}
   */
  static calculatePrice (coverAmount, risk, surplusMargin, coverPeriod) {
    const surplusMultiplier = Decimal(surplusMargin).add(1);
    const pricePerDay = coverAmount
      .mul(risk)
      .div(100)
      .mul(surplusMultiplier)
      .div(DAYS_PER_YEAR);

    return pricePerDay.mul(coverPeriod);
  }

  /**
   * Fetches total staked NXM on a smart contract
   *
   * @param {string} contractAddress
   * @return {Decimal} Staked NXM amount as big.js instance
   */
  async getStakedNxm (contractAddress) {
    const pooledStaking = this.nexusContractLoader.instance('PS');
    const staked = await pooledStaking.contractStake(contractAddress);
    return staked;
  }

  /**
   * Fetches NXM token price in ETH
   *
   * @return {Decimal}
   */
  async getTokenPrice () {
    const tokenFunctions = this.nexusContractLoader.instance('TF');
    const price = await tokenFunctions.getTokenPrice(hex('ETH'));
    return Decimal(price);
  }

  /**
   * Fetches mcrEther from last posted MCR
   *
   * @return {Decimal}
   */
  async getLastMcrEth () {
    const poolData = this.nexusContractLoader.instance('PD');
    const mcrEth = await poolData.getLastMCREther();
    return mcrEth;
  }

  /**
   * Fetches DAI price in wei from Chainlink
   * @return {Decimal}
   */
  async getDaiRate () {
    const chainlinkAggregator = this.nexusContractLoader.instance('CHAINLINK-DAI-ETH');
    const daiRate = await chainlinkAggregator.latestAnswer().call();
    return Decimal(daiRate);
  }

  /**
   * Returns amount of ether wei for 1 currency unit
   * @param {string} currency
   * @return {Promise<string|Decimal>}
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
  static signQuote (quotationData, quotationContractAddress, privateKeyString) {
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
      s: sig.s,
    };
  }

  /**
   * @param {Decimal} requestedCoverAmount Amount user wants to cover in cover currency, ex: 100
   * @param {number} coverPeriod Cover period in days
   * @param {String} coverCurrency Ex: "ETH" or "DAI"
   * @param {Decimal} coverCurrencyRate Amount of wei for 1 cover currency unit
   * @param {Decimal} nxmPrice Amount of wei for 1 NXM
   * @param {Decimal} stakedNxm
   * @param {Decimal} minCapETH
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
   *     coverAmount: Decimal,
   *     priceCoverCurrency: Decimal,
   *     priceNxm: Decimal,
   * }} QuoteCoverable
   *
   * @return {QuoteCoverable|QuoteUncoverable|null}
   */
  static calculateQuote (
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

    const maxGlobalCapacityPerContract = minCapETH.mul(CONTRACT_CAPACITY_LIMIT_PERCENT);
    const maxCapacity = QuoteEngine.calculateCapacity(stakedNxm, nxmPrice, maxGlobalCapacityPerContract);

    const requestedCoverAmountInWei = requestedCoverAmount.mul(coverCurrencyRate);
    // limit cover amount by maxCapacity
    const finalCoverAmountInWei = utils.min(maxCapacity, requestedCoverAmountInWei);

    const risk = this.calculateRisk(stakedNxm);
    console.log(`risk ${risk.toFixed()}`);

    const surplusMargin = COVER_PRICE_SURPLUS_MARGIN;
    const quotePriceInWei = QuoteEngine.calculatePrice(finalCoverAmountInWei, risk, surplusMargin, coverPeriod);

    const quotePriceInCoverCurrencyWei = quotePriceInWei.div(coverCurrencyRate).mul('1e18');
    const quotePriceInNxmWei = quotePriceInWei.div(nxmPrice).mul('1e18');
    const finalCoverInCoverCurrency = finalCoverAmountInWei.div(coverCurrencyRate);

    return {
      coverCurrency,
      coverPeriod,
      coverAmount: finalCoverInCoverCurrency,
      priceCoverCurrency: quotePriceInCoverCurrencyWei,
      priceNxm: quotePriceInNxmWei,
      reason: 'ok',
      expireTime,
      generationTime,
    };
  }

  static calculateRisk (stakedNxm) {
    const STAKED_HIGH_RISK_COST = Decimal(100);
    const LOW_RISK_COST_LIMIT_NXM = Decimal(200000).mul('1e18');
    const PRICING_EXPONENT = Decimal(7);
    const STAKED_LOW_RISK_COST = Decimal(1);
    // uncappedRiskCost = stakedHighRiskCost * [1 - netStakedNXM/lowRiskCostLimit ^ (1/pricingExponent) ];
    const exponent = Decimal(1).div(PRICING_EXPONENT);
    const uncappedRiskCost = STAKED_HIGH_RISK_COST.mul(Decimal(1).sub(stakedNxm.div(LOW_RISK_COST_LIMIT_NXM).pow(exponent)));
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
    const amount = Decimal(coverAmount);
    const period = parseInt(reqPeriod, 10);
    const now = new Date();
    const currencyRate = await this.getCurrencyRate(currency); // ETH amount for 1 unit of the currency
    const nxmPrice = await this.getTokenPrice(); // ETH amount for 1 unit of the currency

    const stakedNxm = await this.getStakedNxm(contractAddress);
    const minCapETH = await this.getLastMcrEth();

    log.info(`Calculating quote with params ${JSON.stringify({
      amount,
      period,
      currency,
      currencyRate,
      nxmPrice,
      stakedNxm,
      minCapETH,
      now,
    })}`);
    const quoteData = QuoteEngine.calculateQuote(
      amount,
      period,
      currency,
      currencyRate,
      nxmPrice,
      stakedNxm,
      minCapETH,
      now,
    );
    log.info(`quoteData result: ${JSON.stringify()}`);

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
