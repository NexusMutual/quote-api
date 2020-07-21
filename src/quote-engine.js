const Decimal = require('decimal.js');
const ethABI = require('ethereumjs-abi');
const util = require('ethereumjs-util');
const BN = require('bn.js');
const utils = require('./utils');
const { hex } = require('./utils');
const log = require('./log');

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
    const stakedNxmEthValue = Decimal(stakedNxm).mul(nxmPriceEth).div('1e18');
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
   * @return {Decimal} Staked NXM amount as decimal.js instance
   */
  async getStakedNxm (contractAddress) {
    const pooledStaking = this.nexusContractLoader.instance('PS');
    const staked = await pooledStaking.contractStake(contractAddress);
    return Decimal(staked.toString());
  }

  /**
   * Fetches NXM token price in ETH
   *
   * @return {Decimal}
   */
  async getTokenPrice () {
    const tokenFunctions = this.nexusContractLoader.instance('TF');
    const price = await tokenFunctions.getTokenPrice(hex('ETH'));
    return Decimal(price.toString());
  }

  /**
   * Fetches mcrEther from last posted MCR
   *
   * @return {Decimal}
   */
  async getLastMcrEth () {
    const poolData = this.nexusContractLoader.instance('PD');
    const mcrEth = await poolData.getLastMCREther();
    return Decimal(mcrEth.toString());
  }

  /**
   * Fetches DAI price in wei from Chainlink
   * @return {Decimal}
   */
  async getDaiRate () {
    const chainlinkAggregator = this.nexusContractLoader.instance('CHAINLINK-DAI-ETH');
    const daiRate = await chainlinkAggregator.latestAnswer().call();
    return Decimal(daiRate.toString());
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
      { value: decimalToBN(quotationData.coverAmount), type: 'uint' },
      { value: currency, type: 'bytes4' },
      { value: new BN(quotationData.coverPeriod), type: 'uint16' },
      { value: quotationData.contractAddress, type: 'address' },
      { value: decimalToBN(quotationData.priceCoverCurrency), type: 'uint' },
      { value: decimalToBN(quotationData.priceNxm), type: 'uint' },
      { value: new BN(quotationData.expireTime), type: 'uint' },
      { value: new BN(quotationData.generationTime), type: 'uint' },
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
   * @param {string} period
   * @return {object|null}
   */
  async getQuote (contractAddress, coverAmount, currency, period) {
    const { valid, error } = QuoteEngine.validateQuoteParameters(contractAddress, coverAmount, currency, period);
    if (!valid) {
      throw new Error(`Invalid parameters provided: ${error}`);
    }
    currency = currency.toUpperCase();
    contractAddress = contractAddress.toLowerCase();
    period = parseInt(period);

    const amount = Decimal(coverAmount);
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
    log.info(`quoteData result: ${JSON.stringify(quoteData)}`);

    const unsignedQuote = { ...quoteData, coverCurrency: currency, contractAddress };
    log.info(`Signing quote..`);
    const quotationAddress = this.nexusContractLoader.instance('QT').address;
    const signature = QuoteEngine.signQuote(unsignedQuote, quotationAddress, this.privateKey);

    return {
      ...unsignedQuote,
      ...signature,
    };
  }

  static validateQuoteParameters (contractAddress, coverAmount, currency, period) {
    if (!isValidEthereumAddress(contractAddress)) {
      return {
        valid: false,
        error: `Contract address ${contractAddress} is invalid.`,
      };
    }

    let amount;
    try {
      amount = Decimal(coverAmount);
    } catch (e) {
      return {
        valid: false,
        error: `Cover amount ${coverAmount} is invalid.`,
      };
    }
    if (amount.lt(0) || !amount.floor().eq(amount)) {
      return {
        valid: false,
        error: `Cover amount ${coverAmount} is invalid.`,
      };
    }

    const SUPPORTED_CURRENCIES = ['ETH', 'DAI'];
    if (!currency || !SUPPORTED_CURRENCIES.includes(currency.toUpperCase())) {
      return {
        valid: false,
        error: `Currency ${currency} is invalid. Use one of ${JSON.stringify(SUPPORTED_CURRENCIES)}.`,
      };
    }

    const parsedPeriod = parseInt(period);
    const MIN_PERIOD = 30;
    const MAX_PERIOD = 365;
    if (isNaN(parsedPeriod) || parsedPeriod < MIN_PERIOD || parsedPeriod > MAX_PERIOD) {
      return {
        valid: false,
        error: `Period ${period} is invalid. Provide an integer value in days between ${MIN_PERIOD} and ${MAX_PERIOD}.`,
      };
    }

    return { valid: true };
  }
}

function decimalToBN (value) {
  return new BN(value.floor().toString());
}

function isValidEthereumAddress (address) {
  const ETHEREUM_ADDRESS_REGEX = /^0(x|X)[a-fA-F0-9]{40}$/;
  return address && address.length === 42 && address.match(ETHEREUM_ADDRESS_REGEX);
}

module.exports = QuoteEngine;
