const Decimal = require('decimal.js');
const ethABI = require('ethereumjs-abi');
const util = require('ethereumjs-util');
const BN = require('bn.js');
const Joi = require('joi');
const moment = require('moment');
const utils = require('./utils');
const { hex } = require('./utils');
const log = require('./log');
const Cover = require('./models/cover');

const DAYS_PER_YEAR = Decimal('365.25');
const CONTRACT_CAPACITY_LIMIT_PERCENT = Decimal('0.2');
const COVER_PRICE_SURPLUS_MARGIN = Decimal('0.3');
const CAPACITY_FACTOR = Decimal('2');

class QuoteEngine {

  /**
   * @param {NexusContractLoader} nexusContractLoader
   * @param {string} privateKey
   * @param {Web3} web3
   * @param {string} capacityFactorEndDate
   */
  constructor (nexusContractLoader, privateKey, web3, capacityFactorEndDate) {
    this.nexusContractLoader = nexusContractLoader;
    this.privateKey = privateKey;
    this.web3 = web3;
    this.pooledStaking = this.nexusContractLoader.instance('PS');

    const format = 'MM/DD/YYYY';
    const endMoment = moment(capacityFactorEndDate, format, true);
    if (!endMoment.isValid()) {
      throw new Error(`Invalid capacityFactorEndDate: ${capacityFactorEndDate}. Use format: ${format}`);
    }
    this.capacityFactorEndDate = endMoment.toDate();
  }

  /**
   * Min [ Max(0, Staked NXM x NXM PriceETH - ActiveCovers ETH) , MaxCapacityPerContract]
   *
   * @param {Decimal} stakedNxm
   * @param {Decimal} nxmPriceEth
   * @param {Decimal} minCapETH
   * @param {[object]} activeCovers
   * @param {object} currencyRates
   * @param {Decimal} capacityFactor
   * @return {Decimal}
   */
  static calculateCapacity (stakedNxm, nxmPriceEth, minCapETH, activeCovers, currencyRates, capacityFactor) {
    const maxGlobalCapacityPerContract = minCapETH.mul(CONTRACT_CAPACITY_LIMIT_PERCENT);
    const stakedNxmEthValue = stakedNxm.mul(nxmPriceEth).div('1e18');
    const activeCoversEthValues = activeCovers.map(cover => currencyRates[cover.currency].mul(cover.sumAssured));
    const activeCoversSumEthValue = activeCoversEthValues.reduce((a, b) => a.add(b), Decimal(0));
    const contractCapacity = utils.max(stakedNxmEthValue.sub(activeCoversSumEthValue), Decimal(0));

    return utils.min(contractCapacity, maxGlobalCapacityPerContract).mul(capacityFactor);
  }

  /**
   * Used for staked and unstaked price calculation (the formula is identical)
   *
   * Cover Amount x Staked Risk Cost x (1 + Surplus Margin) x Cover Period in Days / 365.25
   *
   * @param {Decimal} coverAmount
   * @param {Decimal} risk A number between 0 and 100
   * @param {Decimal} surplusMargin A number to calculate the multiplier (ex 0.3 for 30%)
   * @param {number} coverPeriod Cover period in days (integer)
   * @return {Decimal}
   */
  static calculatePrice (coverAmount, risk, surplusMargin, coverPeriod) {
    const surplusMultiplier = surplusMargin.add(1);
    const pricePerDay = coverAmount
      .mul(risk)
      .div(100)
      .mul(surplusMultiplier)
      .div(DAYS_PER_YEAR);

    return pricePerDay.mul(coverPeriod);
  }

  /**
   * Fetches total net staked NXM on a smart contract at timestamp 'now'
   *
   * @param {string} contractAddress
   * @return {Decimal} Net Staked NXM amount as decimal.js instance
   */
  async getNetStakedNxm (contractAddress) {

    const [stakedNxmBN, firstUnprocessedUnstake, unstakeRequests] = await Promise.all([
      this.pooledStaking.contractStake(contractAddress),
      this.getFirstUnprocessedUnstake(),
      this.getUnstakeRequests(contractAddress),
    ]);

    const totalUnprocessedUnstakeBN = unstakeRequests
      .filter(e => e.unstakeAt.toNumber() >= firstUnprocessedUnstake.unstakeAt.toNumber())
      .map(e => e.amount)
      .reduce((a, b) => a.add(b), new BN('0'));

    const totalUnprocessedUnstake = Decimal(totalUnprocessedUnstakeBN.toString());
    const stakedNxm = Decimal(stakedNxmBN.toString());

    return stakedNxm.sub(totalUnprocessedUnstake.div(2));
  }

  async getFirstUnprocessedUnstake () {
    const headPointer = await this.pooledStaking.unstakeRequests(0);
    return this.pooledStaking.unstakeRequests(headPointer.next);
  }

  /**
   * Fetches total pending unstaked NXM on a smart contract at timestamp 'now'
   *
   * @param {string} contractAddress
   * @return {Decimal} Pending unstaked NXM amount as decimal.js instance
   */
  async getUnstakeRequests (contractAddress) {

    const ASSUMED_BLOCK_TIME = 15;
    const UNSTAKE_PROCESSING_DAYS = 90;
    const BUFFER_DAYS = 30;
    const DAY_IN_SECONDS = 24 * 60 * 60;
    const blocksBack = (UNSTAKE_PROCESSING_DAYS + BUFFER_DAYS) * DAY_IN_SECONDS / ASSUMED_BLOCK_TIME;
    const block = await this.web3.eth.getBlock('latest');
    const fromBlock = block.number - blocksBack;
    const events = await this.pooledStaking.getPastEvents('UnstakeRequested', { fromBlock, filter: { contractAddress } });

    return events.map(e => e.args);
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
    const daiRate = await chainlinkAggregator.latestAnswer();
    return Decimal(daiRate.toString());
  }

  /**
   * Fetches List of active covers for contract at time 'now'.
   * @param {string} contractAddress
   * @param {Date} now
   * @return {[{ contractAddress: string, sumAssured: Decimal, currency: string }]}
   */
  static async getActiveCovers (contractAddress, now) {

    const storedActiveCovers = await Cover.find({
      expirytimeStamp: { $gt: now.getTime() / 1000 },
      lockCN: { $ne: '0' },
      smartContractAdd: contractAddress.toLowerCase(),
    });

    return storedActiveCovers.map(stored => ({
      contractAddress: stored.smartContractAdd,
      sumAssured: stored.sumAssured,
      currency: stored.curr,
    }));
  }

  /**
   * Returns amount of ether wei for 1 currency unit
   * @param {string} currency
   * @return {Promise<Decimal>}
   */
  async getCurrencyRate (currency) {

    if (currency === 'ETH') {
      return Decimal('1e18');
    }

    if (currency === 'DAI') {
      return this.getDaiRate();
    }

    throw new Error(`Unsupported currency ${currency}`);
  }

  /**
   * Returns amount of ether wei for 1 currency unit
   * @return {Promise<object>}
   */
  async getCurrencyRates () {

    const rates = {};

    await Promise.all(['ETH', 'DAI'].map(async currency => {
      rates[currency] = await this.getCurrencyRate(currency);
    }));

    return rates;
  }

  /**
   *
   * @param {object} quotationData
   * @param {string} quotationContractAddress
   * @param {string} privateKeyString
   * @return {{ v: number, r: string, s: string }}
   */
  static signQuote (quotationData, quotationContractAddress, privateKeyString) {

    const currency = '0x' + Buffer.from(quotationData.currency, 'utf8').toString('hex');

    const orderParts = [
      { value: decimalToBN(quotationData.amount), type: 'uint' },
      { value: currency, type: 'bytes4' },
      { value: new BN(quotationData.period), type: 'uint16' },
      { value: quotationData.contract, type: 'address' },
      { value: decimalToBN(quotationData.price), type: 'uint' },
      { value: decimalToBN(quotationData.priceInNXM), type: 'uint' },
      { value: new BN(quotationData.expiresAt), type: 'uint' },
      { value: new BN(quotationData.generatedAt), type: 'uint' },
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
      r: '0x' + util.toUnsigned(util.fromSigned(sig.r)).toString('hex'),
      s: '0x' + util.toUnsigned(util.fromSigned(sig.s)).toString('hex'),
    };
  }

  /**
   * @param {Decimal} requestedCoverAmount Amount user wants to cover in cover currency, ex: 100
   * @param {number} period Cover period in days
   * @param {String} currency Ex: "ETH" or "DAI"
   * @param {Decimal} nxmPrice Amount of wei for 1 NXM
   * @param {Decimal} netStakedNxm
   * @param {Decimal} minCapETH
   * @param {[{ contractAddress: string, sumAssured: Decimal, currency: string }]} activeCovers
   * @param {object} currencyRates
   * @param {Date} now
   * @param {Decimal} capacityFactor
   *
   * @typedef {{
   *   error: string,
   *     generatedAt: number,
   *     expiresAt: number,
   * }} QuoteUncoverable
   *
   * @typedef {{
   *     generatedAt: number,
   *     expiresAt: number,
   *     currency: string,
   *     period: number,
   *     amount: Decimal,
   *     price: Decimal,
   *     princeInNXM: Decimal,
   * }} QuoteCoverable
   *
   * @return {QuoteCoverable|QuoteUncoverable|null}
   */
  static calculateQuote (
    requestedCoverAmount,
    period,
    currency,
    nxmPrice,
    netStakedNxm,
    minCapETH,
    activeCovers,
    currencyRates,
    now,
    capacityFactor
  ) {
    const generatedAt = now.getTime();
    const expiresAt = Math.ceil(generatedAt / 1000 + 3600);
    const coverCurrencyRate = currencyRates[currency];

    if (netStakedNxm.eq(0)) {
      return {
        error: 'Uncoverable',
        generatedAt,
        expiresAt,
      };
    }

    const maxCapacity = QuoteEngine.calculateCapacity(
      netStakedNxm, nxmPrice, minCapETH, activeCovers, currencyRates, capacityFactor
    );
    const requestedCoverAmountInWei = requestedCoverAmount.mul(coverCurrencyRate);

    // limit cover amount by maxCapacity
    const finalCoverAmountInWei = utils.min(maxCapacity, requestedCoverAmountInWei);

    const risk = this.calculateRisk(netStakedNxm);
    const quotePriceInWei = QuoteEngine.calculatePrice(finalCoverAmountInWei, risk, COVER_PRICE_SURPLUS_MARGIN, period);
    const quotePriceInCoverCurrencyWei = quotePriceInWei.div(coverCurrencyRate).mul('1e18');
    const quotePriceInNxmWei = quotePriceInWei.div(nxmPrice).mul('1e18');
    const finalCoverInCoverCurrency = finalCoverAmountInWei.div(coverCurrencyRate);

    return {
      currency,
      period,
      amount: finalCoverInCoverCurrency,
      price: quotePriceInCoverCurrencyWei,
      priceInNXM: quotePriceInNxmWei,
      expiresAt,
      generatedAt,
    };
  }

  /**
   * Calculates risk percentage as a value between 1 and 100
   *
   * @param {Decimal} netStakedNxm
   * @return {Decimal} risk percentage
   */
  static calculateRisk (netStakedNxm) {
    const STAKED_HIGH_RISK_COST = Decimal(100);
    const LOW_RISK_COST_LIMIT_NXM = Decimal(100000).mul('1e18');
    const PRICING_EXPONENT = Decimal(7);
    const STAKED_LOW_RISK_COST = Decimal(1);
    // uncappedRiskCost = stakedHighRiskCost * [1 - netStakedNXM/lowRiskCostLimit ^ (1/pricingExponent) ];
    const exponent = Decimal(1).div(PRICING_EXPONENT);
    const uncappedRiskCost = STAKED_HIGH_RISK_COST
      .mul(Decimal(1).sub(netStakedNxm.div(LOW_RISK_COST_LIMIT_NXM).pow(exponent)));

    return utils.max(STAKED_LOW_RISK_COST, uncappedRiskCost);
  }

  /**
   * Gets capacity factor to multiply the capacity by.
   *
   * @param {Date} contractDateAdded
   * @return {Decimal} capacity factor
   */
  getCapacityFactor (contractDateAdded) {
    return contractDateAdded.getTime() < this.capacityFactorEndDate.getTime() ? CAPACITY_FACTOR : Decimal(1);
  }

  /**
   * @param {string} contractAddress
   * @param {string} coverAmount Requested cover amount (might differ from offered cover amount)
   * @param {string} currency
   * @param {string} period
   * @param {{ dateAdded: string, name: string }} contractData
   * @return {object}
   */
  async getQuote (contractAddress, coverAmount, currency, period, contractData) {
    const { error } = QuoteEngine.validateQuoteParameters(contractAddress, coverAmount, currency, period);
    if (error) {
      throw new Error(`Invalid parameters provided: ${error}`);
    }
    const upperCasedCurrency = currency.toUpperCase();
    const lowerCasedContractAddress = contractAddress.toLowerCase();
    const parsedPeriod = parseInt(period);

    const amount = Decimal(coverAmount);
    const now = new Date();

    const activeCovers = await QuoteEngine.getActiveCovers(lowerCasedContractAddress, now);

    const [currencyRates, nxmPrice, netStakedNxm, minCapETH] = await Promise.all([
      this.getCurrencyRates(),
      this.getTokenPrice(), // ETH amount for 1 unit of the currency
      this.getNetStakedNxm(lowerCasedContractAddress),
      this.getLastMcrEth(),
    ]);
    const capacityFactor = this.getCapacityFactor(new Date(contractData.dateAdded));
    const params = {
      amount: amount.toFixed(),
      period: parsedPeriod,
      currency: upperCasedCurrency,
      currencyRate: currencyRates[upperCasedCurrency].toFixed(),
      nxmPrice: nxmPrice.toFixed(),
      netStakedNxm: netStakedNxm.toFixed(),
      minCapETH: minCapETH.toFixed(),
      now,
      capacityFactor
    };
    log.info(`Calculating quote with params ${JSON.stringify(params)}`);
    const quoteData = QuoteEngine.calculateQuote(
      amount,
      parsedPeriod,
      upperCasedCurrency,
      nxmPrice,
      netStakedNxm,
      minCapETH,
      activeCovers,
      currencyRates,
      now,
      capacityFactor
    );
    log.info(`quoteData result: ${JSON.stringify({
      ...quoteData,
      params,
    })}`);

    const unsignedQuote = { ...quoteData, contract: lowerCasedContractAddress };
    log.info(`Signing quote..`);
    const quotationAddress = this.nexusContractLoader.instance('QT').address;
    const signature = QuoteEngine.signQuote(unsignedQuote, quotationAddress, this.privateKey);

    return {
      ...unsignedQuote,
      ...signature,
    };
  }

  /**
   * @param {string} contractAddress
   * @param {{ dateAdded: string, name: string }} contractData
   * @return {{ capacityETH: Decimal, capacityDAI: Decimal, netStakedNXM: Decimal }}
   */
  async getCapacity (contractAddress, contractData) {

    const now = new Date();
    const activeCovers = await QuoteEngine.getActiveCovers(contractAddress, now);
    const [netStakedNXM, minCapETH, nxmPrice, currencyRates] = await Promise.all([
      this.getNetStakedNxm(contractAddress),
      this.getLastMcrEth(),
      this.getTokenPrice(),
      this.getCurrencyRates(),
    ]);

    log.info(`Detected ${activeCovers.length} active covers.`);
    const capacityFactor = this.getCapacityFactor(new Date(contractData.dateAdded));
    log.info(JSON.stringify({ netStakedNXM, minCapETH, nxmPrice, currencyRates, capacityFactor }));
    const capacityETH = QuoteEngine.calculateCapacity(
      netStakedNXM, nxmPrice, minCapETH, activeCovers, currencyRates, capacityFactor,
      );
    log.info(`Computed capacity for ${contractData.name}(${contractAddress}): ${capacityETH.toFixed()}`);

    const daiRate = currencyRates['DAI'];
    const capacityDAI = capacityETH.div(daiRate).mul('1e18');

    return {
      capacityETH,
      capacityDAI,
      netStakedNXM,
    };
  }

  static validateQuoteParameters (contractAddress, coverAmount, currency, period) {
    const quoteSchema = Joi.object({
      contractAddress: Joi.string()
        .length(42, 'utf8')
        .regex(/^0x[a-f0-9]{40}$/i)
        .example('0x52042c4d8936a7764b18170a6a0762b870bb8e17')
        .required(),
      coverAmount: Joi.string()
        .regex(/^\d+$/)
        .min(1)
        .required(),
      currency: Joi.string()
        .valid('ETH', 'DAI')
        .required(),
      period: Joi.number()
        .min(30)
        .max(365)
        .required(),
    });

    return quoteSchema.validate({
      contractAddress,
      coverAmount,
      currency,
      period,
    });
  }

  static validateCapacityParameters (contractAddress) {
    const quoteSchema = Joi.object({
      contractAddress: Joi.string()
        .length(42, 'utf8')
        .regex(/^0x[a-f0-9]{40}$/i)
        .example('0x52042c4d8936a7764b18170a6a0762b870bb8e17')
        .required(),
    });

    return quoteSchema.validate({ contractAddress });
  }
}

function decimalToBN (value) {
  return new BN(value.floor().toString());
}

module.exports = QuoteEngine;
