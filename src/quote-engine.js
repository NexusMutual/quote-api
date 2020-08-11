const Decimal = require('decimal.js');
const ethABI = require('ethereumjs-abi');
const util = require('ethereumjs-util');
const BN = require('bn.js');
const Joi = require('joi');

const log = require('./log');
const decimalToBN = value => new BN(value.floor().toString());

const DAYS_PER_YEAR = Decimal('365.25');
const COVER_PRICE_SURPLUS_MARGIN = Decimal('0.3');

class QuoteEngine {

  /**
   * @param quotationAddress
   * @param {string} privateKey
   */
  constructor (quotationAddress, privateKey) {
    this.quotationAddress = quotationAddress;
    this.privateKey = privateKey;
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
    return coverAmount
      .mul(risk)
      .div(100)
      .mul(surplusMargin.add(1))
      .div(DAYS_PER_YEAR)
      .mul(coverPeriod);
  }

  /**
   * Fetches NXM token price in ETH
   *
   * @return {Decimal}
   */
  async getTokenPrice () {
    return Decimal(1e18 / 20); // 0.05
  }

  /**
   * Returns amount of ether wei for 1 currency unit
   * @return {Promise<object>}
   */
  async getCurrencyRates () {
    return {
      ETH: Decimal('1e18'),
      DAI: Decimal(1e18 / 20),
    };
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
    netStakedNxm, // unused
    minCapETH, // unused
    activeCovers, // unused
    currencyRates,
    now,
  ) {
    const generatedAt = now.getTime();
    const expiresAt = Math.ceil(generatedAt / 1000 + 3600);
    const coverCurrencyRate = currencyRates[currency];
    const finalCoverAmountInWei = requestedCoverAmount.mul(coverCurrencyRate);

    const risk = Decimal(1);
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
   * @param {string} contractAddress
   * @param {string} coverAmount Requested cover amount (might differ from offered cover amount)
   * @param {string} currency
   * @param {string} period
   * @return {object}
   */
  async getQuote (contractAddress, coverAmount, currency, period) {

    const { error } = QuoteEngine.validateQuoteParameters(contractAddress, coverAmount, currency, period);

    if (error) {
      throw new Error(`Invalid parameters provided: ${error}`);
    }

    const upperCasedCurrency = currency.toUpperCase();
    const lowerCasedContractAddress = contractAddress.toLowerCase();
    const parsedPeriod = parseInt(period);
    const amount = Decimal(coverAmount);
    const now = new Date();

    const currencyRates = await this.getCurrencyRates();
    const nxmPrice = await this.getTokenPrice(); // ETH amount for 1 unit of the currency

    console.log(currencyRates);

    const params = {
      amount: amount.toFixed(),
      period: parsedPeriod,
      currency: upperCasedCurrency,
      currencyRate: currencyRates[upperCasedCurrency].toFixed(),
      nxmPrice: nxmPrice.toFixed(),
      now,
    };

    log.info(`Signing quote with params ${JSON.stringify(params)}`);

    const quoteData = QuoteEngine.calculateQuote(
      amount,
      parsedPeriod,
      upperCasedCurrency,
      nxmPrice,
      'unused',
      'unused',
      'unused',
      currencyRates,
      now,
    );

    log.info(`quoteData result: ${JSON.stringify({
      ...quoteData,
      params,
    })}`);

    const unsignedQuote = { ...quoteData, contract: lowerCasedContractAddress };
    log.info(`Signing quote..`);
    const quotationAddress = this.quotationAddress;
    const signature = QuoteEngine.signQuote(unsignedQuote, quotationAddress, this.privateKey);

    return {
      ...unsignedQuote,
      ...signature,
    };
  }

  /**
   * @param {string} contractAddress
   * @return {{ capacityETH: Decimal, capacityDAI: Decimal, netStakedNXM: Decimal }}
   */
  async getCapacity (contractAddress) {

    return {
      capacityETH: Decimal('1000').mul(1e18),
      capacityDAI: Decimal('20000').mul(1e18),
      netStakedNXM: Decimal('20000').mul(1e18),
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

module.exports = QuoteEngine;
