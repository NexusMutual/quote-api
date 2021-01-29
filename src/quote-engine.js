const Decimal = require('decimal.js');
const ethABI = require('ethereumjs-abi');
const util = require('ethereumjs-util');
const BN = require('bn.js');
const Joi = require('joi');
const moment = require('moment');
const NodeCache = require('node-cache');
const utils = require('./utils');
const { hex } = require('./utils');
const log = require('./log');
const { getWhitelist } = require('./contract-whitelist');
const { Quote } = require('./models');

const {
  DEPENDANT_CONTRACTS,
  MCR_CAPACITY_FACTORS,
  DAYS_PER_YEAR,
  CONTRACT_CAPACITY_LIMIT_PERCENT,
  COVER_PRICE_SURPLUS_MARGIN,
  CAPACITY_FACTOR,
  CAPACITY_LIMIT,
  CURRENCIES,
  ETH,
  TRUSTED_PROTOCOLS,
  TRUSTED_PROTOCOL_CAPACITY_FACTOR,
} = require('./constants');

class QuoteEngine {

  /**
   * @param {NexusContractLoader} nexusContractLoader
   * @param {string} privateKey
   * @param {Web3} web3
   * @param {string} capacityFactorEndDate
   * @param {boolean} enableCapacityReservation
   */
  constructor (nexusContractLoader, privateKey, web3, capacityFactorEndDate, enableCapacityReservation) {
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
    this.capacitiesCache = new NodeCache({ stdTTL: 15, checkperiod: 60 });
    this.enableCapacityReservation = enableCapacityReservation;
  }

  /**
   * Min [ Max(0, Staked NXM x NXM PriceETH - ActiveCovers ETH) , MaxCapacityPerContract]
   *
   * @param {Decimal} netStakedNxm
   * @param {Decimal} nxmPriceEth
   * @param {Decimal} minCapETH
   * @param {[object]} activeCoverAmounts
   * @param {object} currencyRates
   * @param {Decimal} capacityFactor
   * @param {Decimal} mcrCapacityFactor
   * @return {{ capacity: Decimal, limit: string }}
   */
  static calculateCapacity (
    netStakedNxm, nxmPriceEth, minCapETH, activeCoverAmounts, currencyRates, capacityFactor, mcrCapacityFactor,
  ) {
    const maxMCRCapacity = minCapETH.mul(CONTRACT_CAPACITY_LIMIT_PERCENT).mul(mcrCapacityFactor);
    const netStakedNxmEthValue = netStakedNxm.mul(nxmPriceEth).div('1e18');
    const activeCoversEthValues = activeCoverAmounts.map(
      coverAmount => currencyRates[coverAmount.currency].mul(coverAmount.sumAssured),
    );
    const activeCoversSumEthValue = activeCoversEthValues.reduce((a, b) => a.add(b), Decimal(0));

    const maxStakedCapacity = netStakedNxmEthValue.mul(capacityFactor);
    const maxCapacity = utils.min(maxStakedCapacity, maxMCRCapacity);
    const capacityLimit = maxCapacity.toString() === maxStakedCapacity.toString()
      ? CAPACITY_LIMIT.STAKED_CAPACITY : CAPACITY_LIMIT.MCR_CAPACITY;
    const availableCapacity = utils.max(maxCapacity.sub(activeCoversSumEthValue), Decimal(0));

    return { capacity: availableCapacity, capacityLimit };
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
    const pool = this.nexusContractLoader.instance('P1');
    const price = await pool.getTokenPrice(ETH);
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
   * @return {[{ contractAddress: string, sumAssured: Decimal, currency: string }]}
   */
  async getActiveCoverAmounts (contractAddress) {
    const qd = this.nexusContractLoader.instance('QD');
    const lowerCasedContractAddress = contractAddress.toLowerCase();
    const contractAddresses = [lowerCasedContractAddress];
    if (DEPENDANT_CONTRACTS[lowerCasedContractAddress]) {
      contractAddresses.push(...DEPENDANT_CONTRACTS[lowerCasedContractAddress]);
    }
    const contractAddressesLowerCased = contractAddresses.map(a => a.toLowerCase());

    const activeCoverAmounts = [];
    for (const contractAddress of contractAddressesLowerCased) {
      const amounts = await Promise.all(
        CURRENCIES.map(async (currency) => {
          const sumAssured = await qd.getTotalSumAssuredSC(contractAddress, hex(currency));
          return {
            sumAssured: Decimal(sumAssured.toString()),
            contractAddress,
            currency,
          };
        }),
      );
      activeCoverAmounts.push(...amounts);
    }

    return activeCoverAmounts;
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
      r: '0x' + util.setLengthLeft(util.toUnsigned(util.fromSigned(sig.r)), 32).toString('hex'),
      s: '0x' + util.setLengthLeft(util.toUnsigned(util.fromSigned(sig.s)), 32).toString('hex'),
    };
  }

  /**
   * @param {Decimal} requestedCoverAmount Amount user wants to cover in cover currency, ex: 100
   * @param {number} period Cover period in days
   * @param {String} currency Ex: "ETH" or "DAI"
   * @param {Decimal} nxmPrice Amount of wei for 1 NXM
   * @param {Decimal} netStakedNxm
   * @param {Decimal} maxCapacity
   * @param {object} currencyRates
   * @param {Date} now
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
    maxCapacity,
    currencyRates,
    now,
  ) {
    const generatedAt = now.getTime();
    const expiresAt = Math.ceil(generatedAt / 1000 + 900);
    const coverCurrencyRate = currencyRates[currency];

    if (netStakedNxm.eq(0)) {
      return {
        error: 'Uncoverable',
        generatedAt,
        expiresAt,
      };
    }

    const requestedCoverAmountInWei = requestedCoverAmount.mul(coverCurrencyRate);

    // limit cover amount by maxCapacity
    const finalCoverAmountInWei = utils.min(maxCapacity, requestedCoverAmountInWei);

    const risk = this.calculateRisk(netStakedNxm);
    const quotePriceInWei = QuoteEngine.calculatePrice(finalCoverAmountInWei, risk, COVER_PRICE_SURPLUS_MARGIN, period);
    const quotePriceInCoverCurrencyWei = quotePriceInWei.div(coverCurrencyRate).mul('1e18').floor();
    const quotePriceInNxmWei = quotePriceInWei.div(nxmPrice).mul('1e18').floor();
    const finalCoverInCoverCurrency = finalCoverAmountInWei.div(coverCurrencyRate).floor();

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
    const LOW_RISK_COST_LIMIT_NXM = Decimal(50000).mul('1e18');
    const PRICING_EXPONENT = Decimal(7);
    const STAKED_LOW_RISK_COST = Decimal(2);
    // uncappedRiskCost = stakedHighRiskCost * [1 - netStakedNXM/lowRiskCostLimit ^ (1/pricingExponent) ];
    const exponent = Decimal(1).div(PRICING_EXPONENT);
    const uncappedRiskCost = STAKED_HIGH_RISK_COST
      .mul(Decimal(1).sub(netStakedNxm.div(LOW_RISK_COST_LIMIT_NXM).pow(exponent)));

    return utils.max(STAKED_LOW_RISK_COST, uncappedRiskCost);
  }

  /**
   * Gets capacity factor to multiply the capacity by.
   *
   * @param {{ dateAdded: string, type: string, contractAddress: string }}
   * @return {Decimal} capacity factor
   */
  getCapacityFactor ({ dateAdded, type, contractAddress }) {
    const contractDateAdded = new Date(dateAdded);

    if (TRUSTED_PROTOCOLS.includes(contractAddress)) {
      return TRUSTED_PROTOCOL_CAPACITY_FACTOR;
    }

    if (type === 'custodian' || contractDateAdded.getTime() < this.capacityFactorEndDate.getTime()) {
      return CAPACITY_FACTOR;
    }

    return Decimal(1);
  }

  /**
   * Gets MCR capacity factor to multiply the MCR capacity limit by.
   *
   * @param {string} contractAddress
   * @return {Decimal} capacity factor
   */
  getMCRCapacityFactor (contractAddress) {
    const factor = MCR_CAPACITY_FACTORS[contractAddress];
    return factor || Decimal(1);
  }

  /**
   * @param {string} rawContractAddress
   * @param {string} rawCoverAmount Requested cover amount (might differ from offered cover amount)
   * @param {string} rawCurrency
   * @param {string} rawPeriod
   * @param {{ dateAdded: string, name: string, type: string }} contractData
   * @return {object}
   */
  async getQuote (rawContractAddress, rawCoverAmount, rawCurrency, rawPeriod, contractData) {

    const { error } = QuoteEngine.validateQuoteParameters(rawContractAddress, rawCoverAmount, rawCurrency, rawPeriod);

    if (error) {
      throw new Error(`Invalid parameters provided: ${error}`);
    }

    const currency = rawCurrency.toUpperCase();
    const contractAddress = rawContractAddress.toLowerCase();
    const parsedPeriod = parseInt(rawPeriod);
    const amount = new Decimal(rawCoverAmount);
    const now = new Date();

    const activeCoverAmounts = await this.getActiveCoverAmounts(contractAddress);
    log.info(`Detected active cover amounts: ${JSON.stringify(activeCoverAmounts)}.`);

    const [currencyRates, nxmPrice, netStakedNxm] = await Promise.all([
      this.getCurrencyRates(),
      this.getTokenPrice(), // ETH amount for 1 unit of the currency
      this.getNetStakedNxm(contractAddress),
    ]);

    // TODO: deduplicate getActiveCoverAmounts() call
    const maxCapacity = await this.getCapacity(rawContractAddress, contractData, false);
    const quoteData = QuoteEngine.calculateQuote(
      amount,
      parsedPeriod,
      currency,
      nxmPrice,
      netStakedNxm,
      maxCapacity,
      activeCoverAmounts,
      currencyRates,
      now,
    );

    const unsignedQuote = { ...quoteData, contract: contractAddress };

    if (unsignedQuote.error) {
      log.info(`Quote error: ${JSON.stringify(unsignedQuote)}`);
      return unsignedQuote;
    }

    log.info(`Signing quote..`);
    const quotationAddress = this.nexusContractLoader.instance('QT').address;
    const signature = QuoteEngine.signQuote(unsignedQuote, quotationAddress, this.privateKey);

    const signedQuote = { ...unsignedQuote, ...signature };
    log.info(`Signed quote: ${JSON.stringify(signedQuote)}`);

    return signedQuote;
  }

  /**
   * @param {string} contractAddress
   * @param {{ dateAdded: string, name: string, type: string }} contractData
   * @param currencyRates
   * @param {{ dateAdded: string, name: string, type: string }} contractData
   * @param {boolean} allowCached
   * @return {{ capacityETH: Decimal, capacityLimit: Decimal, netStakedNXM: Decimal }}
   */
  async getOnchainCapacity (contractAddress, contractData, currencyRates, allowCached) {

    const cachedCapacity = this.capacitiesCache.get(contractAddress);
    const isCacheExpired = typeof cachedCapacity === 'undefined';

    if (allowCached && !isCacheExpired) {
      return cachedCapacity;
    }

    const activeCoverAmounts = await this.getActiveCoverAmounts(contractAddress);
    log.info(`Detected active cover amounts: ${JSON.stringify(activeCoverAmounts)}.`);

    const [netStakedNXM, minCapETH, nxmPrice] = await Promise.all([
      this.getNetStakedNxm(contractAddress),
      this.getLastMcrEth(),
      this.getTokenPrice(),
    ]);

    const capacityFactor = this.getCapacityFactor({ ...contractData, contractAddress });
    const mcrCapacityFactor = this.getMCRCapacityFactor(contractAddress);
    log.info(JSON.stringify({ netStakedNXM, minCapETH, nxmPrice, currencyRates, capacityFactor }));

    const { capacity: capacityETH, capacityLimit } = QuoteEngine.calculateCapacity(
      netStakedNXM,
      nxmPrice,
      minCapETH,
      activeCoverAmounts,
      currencyRates,
      capacityFactor,
      mcrCapacityFactor,
    );
    log.info(`Computed capacity for ${contractData.name}(${contractAddress}): ${capacityETH.toFixed()}`);

    // cache capacities
    this.capacitiesCache.set(contractAddress, { capacityETH, capacityLimit, netStakedNXM });

    return { capacityETH, capacityLimit, netStakedNXM };
  }

  /**
   * Returns currently reserved capacity in ether wei
   * @param {string} contract
   * @param currencyRates
   * @return Decimal
   */
  async getReservedCapacity (contract, currencyRates) {

    if (!this.enableCapacityReservation) {
      return new Decimal(0);
    }

    const now = Date.now() / 1000;
    const contracts = [contract, ...DEPENDANT_CONTRACTS[contract]].map(c => c.toLowerCase());
    const activeQuotes = await Quote.find({ expiresAt: { $gte: now }, contract: { $in: contracts } });

    log.info(`Found ${activeQuotes.length} active quotes`);

    const calculateReserved = (quotes, currency) => quotes
      .filter(quote => quote.currency === currency)
      .reduce((total, quote) => total.add(quote.amount), new Decimal(0));

    const reservedDAI = calculateReserved(activeQuotes, 'DAI').mul('1e18');
    const reservedETH = calculateReserved(activeQuotes, 'ETH').mul('1e18');

    const daiRate = currencyRates['DAI'];
    const reservedTotal = reservedDAI.mul(daiRate).div('1e18').add(reservedETH);

    log.info(`Reserved in active quotes: ${reservedETH.toFixed(0)} ETH and ${reservedDAI.toFixed(0)} DAI`);

    return reservedTotal;
  }

  /**
   * @param {string} rawContractAddress
   * @param {{ dateAdded: string, name: string, type: string }} contractData
   * @param {boolean} allowCached
   * @return {{ capacityETH: Decimal, capacityDAI: Decimal, netStakedNXM: Decimal }}
   */
  async getCapacity (rawContractAddress, contractData, allowCached) {

    const contractAddress = rawContractAddress.toLowerCase();
    const currencyRates = await this.getCurrencyRates();
    const daiRate = currencyRates['DAI'];

    const reservedCapacity = await this.getReservedCapacity(contractAddress, currencyRates);
    const { capacityETH, capacityLimit, netStakedNXM } = await this.getOnchainCapacity(
      contractAddress,
      contractData,
      currencyRates,
      allowCached,
    );

    const capacityDAI = capacityETH.div(daiRate).mul('1e18');
    const availableCapacityETH = utils.max(capacityETH.sub(reservedCapacity), 0);
    const availableCapacityDAI = availableCapacityETH.div(daiRate).mul('1e18');

    return {
      capacityETH,
      capacityDAI,
      availableCapacityETH,
      availableCapacityDAI,
      netStakedNXM,
      capacityLimit,
    };
  }

  /**
   * @return {Promise<[{ capacityETH: Decimal, capacityDAI: Decimal, netStakedNXM: Decimal }]>}
   */
  async getCapacities () {
    const whitelist = await getWhitelist();
    return Promise.all(Object.keys(whitelist).map(async contractAddress => {
      const contractData = whitelist[contractAddress];
      const capacity = await this.getCapacity(contractAddress, contractData, true);
      return { ...capacity, contractAddress };
    }));
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
