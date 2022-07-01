const Decimal = require('decimal.js');
const ethABI = require('ethereumjs-abi');
const util = require('ethereumjs-util');
const BN = require('bn.js');
const Joi = require('joi');
const moment = require('moment');
const NodeCache = require('node-cache');
const utils = require('./utils');
const {hex} = require('./utils');
const log = require('./log');
const {getWhitelist} = require('./contract-whitelist');
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

const DAY_IN_SECONDS = 24 * 60 * 60;

class QuoteEngine {

  /**
   * @param {NexusContractLoader} nexusContractLoader
   * @param {string} privateKey
   * @param {Web3} web3
   * @param {string} capacityFactorEndDate
   * @param {number} quoteSignMinInterval
   */
  constructor(nexusContractLoader, privateKey, web3, capacityFactorEndDate, quoteSignMinInterval) {
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

    this.capacitiesCache = new NodeCache({stdTTL: 15, checkperiod: 60});

    if (!Number.isInteger(quoteSignMinInterval)) {
      throw new Error(`Invalid quoteSignMinInterval: ${quoteSignMinInterval}`);
    }
    this.quoteSignMinInterval = quoteSignMinInterval * 1000;
    this.lastSignatureTimes = {};
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
  static calculateCapacity(
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
    const capacityLimit = maxCapacity.toFixed() === maxStakedCapacity.toFixed()
      ? CAPACITY_LIMIT.STAKED_CAPACITY : CAPACITY_LIMIT.MCR_CAPACITY;
    const availableCapacity = utils.max(maxCapacity.sub(activeCoversSumEthValue), Decimal(0));

    return {capacity: availableCapacity, capacityLimit};
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
  static calculatePrice(coverAmount, risk, surplusMargin, coverPeriod) {
    const surplusMultiplier = surplusMargin.add(1);
    const pricePerDay = coverAmount
      .mul(risk)
      .div(100)
      .mul(surplusMultiplier)
      .div(DAYS_PER_YEAR);

    return pricePerDay.mul(coverPeriod);
  }

  /**
   * Fetches total unprocessed unstakes for a contract
   *
   * @param {string} contractAddress
   * @return {Decimal} Net Staked NXM amount as decimal.js instance
   */
  async getTotalUnprocessedUnstake(contractAddress) {

    const [firstUnprocessedUnstake, unstakeRequestEvents] = await Promise.all([
      this.getFirstUnprocessedUnstake(),
      this.getUnstakeRequests(contractAddress),
    ]);

    /*
      unstake requests were migrated to 30 days after transaction
      https://etherscan.io/tx/0xabf17599450bf3689f16588b6b473036a65275564655aa768af315312a1b7792
      Therefore, need to substract 90 - 30 = 60 days from each unstakeAt field in events pre-dating that tx.
    */
    const unstakeRequests = unstakeRequestEvents.map(e => {
      if (e.blockNumber <= 11678825) {
        const args = e.args;
        args.unstakeAt = args.unstakeAt.subn(DAY_IN_SECONDS * 60);
      }

      return e.args;
    });

    const totalUnprocessedUnstakeBN = unstakeRequests
      .filter(e => e.unstakeAt.toNumber() >= firstUnprocessedUnstake.unstakeAt.toNumber())
      .map(e => e.amount)
      .reduce((a, b) => a.add(b), new BN('0'));

    const totalUnprocessedUnstake = toDecimal(totalUnprocessedUnstakeBN);
    return totalUnprocessedUnstake;
  }

  async getFirstUnprocessedUnstake() {
    const headPointer = await this.pooledStaking.unstakeRequests(0);
    return this.pooledStaking.unstakeRequests(headPointer.next);
  }

  /**
   * Fetches total pending unstaked NXM on a smart contract at timestamp 'now'
   *
   * @param {string} contractAddress
   * @return {Decimal} Pending unstaked NXM amount as decimal.js instance
   */
  async getUnstakeRequests(contractAddress) {

    const ASSUMED_BLOCK_TIME = 15;
    const UNSTAKE_PROCESSING_DAYS = 30;
    const BUFFER_DAYS = 30;
    const blocksBack = (UNSTAKE_PROCESSING_DAYS + BUFFER_DAYS) * DAY_IN_SECONDS / ASSUMED_BLOCK_TIME;
    const block = await this.web3.eth.getBlock('latest');
    const fromBlock = block.number - blocksBack;
    const events = await this.pooledStaking.getPastEvents('UnstakeRequested', {fromBlock, filter: {contractAddress}});

    return events;
  }

  /**
   * Fetches NXM token price in ETH
   *
   * @return {Decimal}
   */
  async getTokenPrice() {
    const pool = this.nexusContractLoader.instance('P1');
    const price = await pool.getTokenPrice(ETH);
    return toDecimal(price);
  }

  /**
   * Fetches mcrEther from last posted MCR
   *
   * @return {Decimal}
   */
  async getLastMcrEth() {
    const poolData = this.nexusContractLoader.instance('MC');
    const mcrEth = await poolData.getMCR();
    return toDecimal(mcrEth);
  }

  /**
   * Fetches DAI price in wei from Chainlink
   * @return {Decimal}
   */
  async getDaiRate() {
    const chainlinkAggregator = this.nexusContractLoader.instance('CHAINLINK-DAI-ETH');
    const daiRate = await chainlinkAggregator.latestAnswer();
    return toDecimal(daiRate);
  }

  /**
   * Fetches List of active covers for contract at time 'now'.
   * @param {string} contractAddress
   * @return {[{ contractAddress: string, sumAssured: Decimal, currency: string }]}
   */
  async getActiveCoverAmounts(contractAddress) {
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
            sumAssured: toDecimal(sumAssured),
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
  async getCurrencyRate(currency) {

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
  async getCurrencyRates() {

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
  static signQuote(quotationData, quotationContractAddress, privateKeyString) {

    const currency = '0x' + Buffer.from(quotationData.currency, 'utf8').toString('hex');

    const orderParts = [
      {value: decimalToBN(quotationData.amount), type: 'uint'},
      {value: currency, type: 'bytes4'},
      {value: new BN(quotationData.period), type: 'uint16'},
      {value: quotationData.contract, type: 'address'},
      {value: decimalToBN(quotationData.price), type: 'uint'},
      {value: decimalToBN(quotationData.priceInNXM), type: 'uint'},
      {value: new BN(quotationData.expiresAt), type: 'uint'},
      {value: new BN(quotationData.generatedAt), type: 'uint'},
      {value: quotationContractAddress, type: 'address'},
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
   * @param {Decimal} minCapETH
   * @param {[{ contractAddress: string, sumAssured: Decimal, currency: string }]} activeCoverAmounts
   * @param {object} currencyRates
   * @param {Date} now
   * @param {Decimal} capacityFactor
   * @param {Decimal} mcrCapacityFactor
   * @param {number} fixedAnnualPrice
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
  static calculateQuote(
    requestedCoverAmount,
    period,
    currency,
    nxmPrice,
    netStakedNxm,
    minCapETH,
    activeCoverAmounts,
    currencyRates,
    now,
    capacityFactor,
    mcrCapacityFactor,
    fixedAnnualPrice,
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

    const {capacity: maxCapacity} = QuoteEngine.calculateCapacity(
      netStakedNxm, nxmPrice, minCapETH, activeCoverAmounts, currencyRates, capacityFactor, mcrCapacityFactor,
    );
    const requestedCoverAmountInWei = requestedCoverAmount.mul(coverCurrencyRate);

    // limit cover amount by maxCapacity
    const finalCoverAmountInWei = utils.min(maxCapacity, requestedCoverAmountInWei);

    const risk = this.calculateRisk(netStakedNxm);

    let quotePriceInWei;
    if (fixedAnnualPrice) {
      quotePriceInWei = finalCoverAmountInWei.mul(fixedAnnualPrice).div(10000).mul(period).div(365.25);
    } else {
      quotePriceInWei = QuoteEngine.calculatePrice(finalCoverAmountInWei, risk, COVER_PRICE_SURPLUS_MARGIN, period);
    }

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
   * Calculates the  quote adjusted net staked NXM as the difference between staked and
   *  1/2 of total unprocessed unstakes.
   * This adjustment artificially creates more capacity than what is actually available.
   *
   * @param {Decimal} stakedNxm
   * @param {Decimal} totalUnprocessedUnstake
   * @return {Decimal} netStakedNxm
   */
  static calculateQuoteAdjustedNetStakedNxm(stakedNxm, totalUnprocessedUnstake) {
    const netStakedNxm = stakedNxm.sub(totalUnprocessedUnstake.div(2));
    return netStakedNxm;
  }

  /**
   * Calculates risk percentage as a value between 1 and 100
   *
   * @param {Decimal} netStakedNxm
   * @return {Decimal} risk percentage
   */
  static calculateRisk(netStakedNxm) {
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
  getCapacityFactor({dateAdded, type, contractAddress}) {
    const contractDateAdded = new Date(dateAdded);

    if (TRUSTED_PROTOCOLS.includes(contractAddress)) {
      return TRUSTED_PROTOCOL_CAPACITY_FACTOR;
    }

    return CAPACITY_FACTOR;
  }

  /**
   * Gets MCR capacity factor to multiply the MCR capacity limit by.
   *
   * @param {string} contractAddress
   * @return {Decimal} capacity factor
   */
  getMCRCapacityFactor(contractAddress) {
    const factor = MCR_CAPACITY_FACTORS[contractAddress];
    return factor || Decimal(1);
  }

  /**
   * @param {string} contractAddress
   * @param {string} coverAmount Requested cover amount (might differ from offered cover amount)
   * @param {string} currency
   * @param {string} period
   * @param {{ dateAdded: string, name: string }} contractData
   * @return {object}
   */
  async getQuote(contractAddress, coverAmount, currency, period, contractData) {
    const {error} = QuoteEngine.validateQuoteParameters(contractAddress, coverAmount, currency, period);

    if (error) {
      throw new Error(`Invalid parameters provided: ${error}`);
    }
    const upperCasedCurrency = currency.toUpperCase();
    const lowerCasedContractAddress = contractAddress.toLowerCase();
    const parsedPeriod = parseInt(period);

    const amount = Decimal(coverAmount);
    const now = new Date();

    // take the most recent signature time from the set of all related contracts
    const dependants = DEPENDANT_CONTRACTS[lowerCasedContractAddress] || [];
    const all = [lowerCasedContractAddress];
    all.push(...dependants);
    const lastSignatureTime = Math.max(...[all.map(c => this.lastSignatureTimes[c])]) || 0;

    const nowTimestamp = now.getTime();
    const timePassedSinceLastSignature = nowTimestamp - lastSignatureTime;
    log.info(`For ${lowerCasedContractAddress} timePassedSinceLastSignature: ${timePassedSinceLastSignature}`);
    if (lastSignatureTime === 0 || timePassedSinceLastSignature > this.quoteSignMinInterval) {
      log.info(`lastSignatureTimes[${lowerCasedContractAddress}] = ${nowTimestamp}`);
      this.lastSignatureTimes[lowerCasedContractAddress] = nowTimestamp;
    } else {
      log.error(`Too many requests for ${lowerCasedContractAddress}`);
      const e = Error('Too many requests');
      e.status = 429;
      throw e;
    }

    const activeCoverAmounts = await this.getActiveCoverAmounts(lowerCasedContractAddress);
    log.info(`Detected active cover amounts: ${JSON.stringify(activeCoverAmounts)}.`);

    const [currencyRates, nxmPrice, totalUnprocessedUnstake, minCapETH, contractStake] = await Promise.all([
      this.getCurrencyRates(),
      this.getTokenPrice(), // ETH amount for 1 unit of the currency
      this.getTotalUnprocessedUnstake(lowerCasedContractAddress),
      this.getLastMcrEth(),
      this.pooledStaking.contractStake(lowerCasedContractAddress)
    ]);

    const netStakedNxm = QuoteEngine.calculateQuoteAdjustedNetStakedNxm(toDecimal(contractStake), totalUnprocessedUnstake);

    const capacityFactor = this.getCapacityFactor({...contractData, contractAddress: lowerCasedContractAddress});
    const mcrCapacityFactor = this.getMCRCapacityFactor(lowerCasedContractAddress);
    const params = {
      amount: amount.toFixed(),
      period: parsedPeriod,
      currency: upperCasedCurrency,
      currencyRate: currencyRates[upperCasedCurrency].toFixed(),
      nxmPrice: nxmPrice.toFixed(),
      netStakedNxm: netStakedNxm.toFixed(),
      minCapETH: minCapETH.toFixed(),
      now,
      capacityFactor,
      mcrCapacityFactor,
    };
    log.info(`Calculating quote with params ${JSON.stringify(params)}`);
    const fixedAnnualPrice =
      contractAddress === '0x0000000000000000000000000000000000000025' && 210 || // Stakewise operated
      contractAddress === '0x0000000000000000000000000000000000000026' && 230 || // Stakewise 3rd party
      0;
    const quoteData = QuoteEngine.calculateQuote(
      amount,
      parsedPeriod,
      upperCasedCurrency,
      nxmPrice,
      netStakedNxm,
      minCapETH,
      activeCoverAmounts,
      currencyRates,
      now,
      capacityFactor,
      mcrCapacityFactor,
      fixedAnnualPrice,
    );
    log.info(`quoteData result: ${JSON.stringify({
      ...quoteData,
      params,
    })}`);

    const unsignedQuote = {...quoteData, contract: lowerCasedContractAddress};
    if (unsignedQuote.error) {
      return unsignedQuote;
    }

    log.info(`Signing quote..`);
    const quotationAddress = this.nexusContractLoader.instance('QT').address;

    const signature = QuoteEngine.signQuote(unsignedQuote, quotationAddress, this.privateKey);
    return {
      ...unsignedQuote,
      ...signature,
    };
  }

  /**
   * @param {string} rawContractAddress
   * @param {{ dateAdded: string, name: string, type: string }} contractData
   * @return {Promise<{ capacityETH: Decimal, capacityDAI: Decimal, netStakedNXM: Decimal }>}
   */
  async getCapacity(rawContractAddress, contractData) {
    const contractAddress = rawContractAddress.toLowerCase();
    const cachedCapacity = this.capacitiesCache.get(contractAddress);
    if (cachedCapacity) {
      return cachedCapacity;
    }

    const activeCoverAmounts = await this.getActiveCoverAmounts(contractAddress);
    const [totalUnprocessedUnstake, minCapETH, nxmPrice, currencyRates, contractStake] = await Promise.all([
      this.getTotalUnprocessedUnstake(contractAddress),
      this.getLastMcrEth(),
      this.getTokenPrice(),
      this.getCurrencyRates(),
      this.pooledStaking.contractStake(contractAddress)
    ]);

    const netStakedNXM = QuoteEngine.calculateQuoteAdjustedNetStakedNxm(toDecimal(contractStake), totalUnprocessedUnstake);

    log.info(`Detected active cover amounts: ${JSON.stringify(activeCoverAmounts)}.`);
    const capacityFactor = this.getCapacityFactor({...contractData, contractAddress});
    const mcrCapacityFactor = this.getMCRCapacityFactor(contractAddress);
    log.info(JSON.stringify({netStakedNXM, minCapETH, nxmPrice, currencyRates, capacityFactor}));
    const {capacity: capacityETH, capacityLimit} = QuoteEngine.calculateCapacity(
      netStakedNXM, nxmPrice, minCapETH, activeCoverAmounts, currencyRates, capacityFactor, mcrCapacityFactor,
    );
    log.info(`Computed capacity for ${contractData.name}(${contractAddress}): ${capacityETH.toFixed()}`);

    const daiRate = currencyRates['DAI'];
    const capacityDAI = capacityETH.div(daiRate).mul('1e18');

    const capacity = {
      capacityETH,
      capacityDAI,
      netStakedNXM,
      capacityLimit,
    };
    this.capacitiesCache.set(contractAddress, capacity);
    return capacity;
  }

  /**
   * @return {Promise<[{ capacityETH: Decimal, capacityDAI: Decimal, netStakedNXM: Decimal }]>}
   */
  async getCapacities() {
    const whitelist = await getWhitelist();

    const capacities = await Promise.all(Object.keys(whitelist).map(async contractAddress => {
      const contractData = whitelist[contractAddress];
      const capacity = await this.getCapacity(contractAddress, contractData);
      return {...capacity, contractAddress};
    }));

    return capacities;
  }

  static validateQuoteParameters(contractAddress, coverAmount, currency, period) {
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

  static validateCapacityParameters(contractAddress) {
    const quoteSchema = Joi.object({
      contractAddress: Joi.string()
        .length(42, 'utf8')
        .regex(/^0x[a-f0-9]{40}$/i)
        .example('0x52042c4d8936a7764b18170a6a0762b870bb8e17')
        .required(),
    });

    return quoteSchema.validate({contractAddress});
  }
}

function decimalToBN(value) {
  return new BN(value.floor().toFixed());
}

function toDecimal(value) {
  return new Decimal(value.toString());
}

module.exports = QuoteEngine;
