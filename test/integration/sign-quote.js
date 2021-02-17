const { contract } = require('@openzeppelin/test-environment');
const Decimal = require('decimal.js');
const QuoteEngine = require('../../src/quote-engine');
const { hex } = require('../../src/utils');
const assert = require('assert');

const Quotation = contract.fromArtifact('QuotationMock');

describe('QuoteEngine.signQuote', function () {

  before(async function () {
    const qt = await Quotation.new(authQuoteEngineAddress);
    this.qt = qt;
  });

  const authQuoteEngineAddress = '0x51042c4d8936a7764d18370a6a0762b860bb8e07';
  const authQuoteEnginePrivateKey = '45571723d6f6fa704623beb284eda724459d76cc68e82b754015d6e7af794cc8';

  const ethQuotationData = {
    currency: 'ETH',
    period: 100,
    amount: Decimal('1000'),
    price: Decimal('13346578668603537188'),
    priceInNXM: Decimal('451561311853817774240'),
    expiresAt: 1595434956,
    generatedAt: 1595431355422,
    contract: '0x3d9819210a31b4961b30ef54be2aed79b9c9cd3b',
  };

  const daiQuotationData = {
    currency: 'DAI',
    period: 170,
    amount: Decimal('17000000'),
    price: Decimal('13346578668603537188'),
    priceInNXM: Decimal('451561311853817774240'),
    expiresAt: 1595434956,
    generatedAt: 1595431355422,
    contract: '0x3d9819210a31b4961b30ef54be2aed79b9c9cd3b',
  };

  it('signs a valid ETH quote for Quotation.sol contract', async function () {
    const { qt } = this;
    const sig = QuoteEngine.signQuote(ethQuotationData, qt.address, authQuoteEnginePrivateKey);
    const coverDetails = new Array(5);
    coverDetails[0] = ethQuotationData.amount.toFixed();
    coverDetails[1] = ethQuotationData.price.toFixed();
    coverDetails[2] = ethQuotationData.priceInNXM.toFixed();
    coverDetails[3] = ethQuotationData.expiresAt;
    coverDetails[4] = ethQuotationData.generatedAt;
    const isValid = await qt.verifySign(
      coverDetails,
      ethQuotationData.period,
      hex(ethQuotationData.currency),
      ethQuotationData.contract,
      sig.v,
      sig.r,
      sig.s,
    );
    assert.equal(isValid, true);
  });

  it.only('signs a valid DAI quote for Quotation.sol contract', async function () {
    const { qt } = this;
    const quotationData = daiQuotationData;
    const sig = QuoteEngine.signQuote(quotationData, qt.address, authQuoteEnginePrivateKey);
    const coverDetails = new Array(5);
    coverDetails[0] = quotationData.amount.toFixed();
    coverDetails[1] = quotationData.price.toFixed();
    coverDetails[2] = quotationData.priceInNXM.toFixed();
    coverDetails[3] = quotationData.expiresAt;
    coverDetails[4] = quotationData.generatedAt;
    const isValid = await qt.verifySign(
      coverDetails,
      quotationData.period,
      hex(quotationData.currency),
      quotationData.contract,
      sig.v,
      sig.r,
      sig.s,
    );
    assert.equal(isValid, true);
  });

  it.only('signs a valid DAI quote for Quotation.sol contract', async function () {
    const { qt } = this;

    const quotationData = {
      currency: 'DAI',
      period: 60,
      amount: Decimal('146321'),
      price: Decimal('1455453183062400175000'),
      priceInNXM: Decimal('26511770517963136083'),
      expiresAt: 1612262274,
      generatedAt: 1612261373682,
      contract: '0xfa5047c9c78b8877af97bdcb85db743fd7313d4a',
    };

    const sig = QuoteEngine.signQuote(quotationData, qt.address, authQuoteEnginePrivateKey);
    const coverDetails = new Array(5);
    coverDetails[0] = quotationData.amount.toFixed();
    coverDetails[1] = quotationData.price.toFixed();
    coverDetails[2] = quotationData.priceInNXM.toFixed();
    coverDetails[3] = quotationData.expiresAt;
    coverDetails[4] = quotationData.generatedAt;
    const isValid = await qt.verifySign(
      coverDetails,
      quotationData.period,
      hex(quotationData.currency),
      quotationData.contract,
      sig.v,
      sig.r,
      sig.s,
    );
    assert.equal(isValid, true);
  });

  it('signs a valid DAI quote for Quotation.sol contract', async function () {
    const { qt } = this;
    
    for (let i = 0; i < 1; i++) {
      console.log(` sig ${i}`);
      // const quotationData = {
      //   ...daiQuotationData,
      //   period: daiQuotationData.period + i % 100,
      //   amount: daiQuotationData.amount.add(i),
      //   price: daiQuotationData.price.add(i),
      //   createdAt: daiQuotationData.createdAt + i,
      //   generatedAt: daiQuotationData.generatedAt + i,
      // };

      const quotationData = {
        currency: 'DAI',
        period: 60,
        amount: Decimal('146321'),
        price: Decimal('1455453183062400175000'),
        priceInNXM: Decimal('26511770517963136083'),
        expiresAt: 1612262274,
        generatedAt: 1612261373682,
        contract: '0xfa5047c9c78b8877af97bdcb85db743fd7313d4a',
      };
      const sig = QuoteEngine.signQuote(quotationData, qt.address, authQuoteEnginePrivateKey);
      const coverDetails = new Array(5);
      coverDetails[0] = quotationData.amount.toFixed();
      coverDetails[1] = quotationData.price.toFixed();
      coverDetails[2] = quotationData.priceInNXM.toFixed();
      coverDetails[3] = quotationData.expiresAt;
      coverDetails[4] = quotationData.generatedAt;

      console.log({
        v: sig.v,
        r: sig.r,
        s: sig.s
      })
      const isValid = await qt.verifySign(
        coverDetails,
        quotationData.period,
        hex(quotationData.currency),
        quotationData.contract,
        sig.v,
        sig.r,
        sig.s,
      );
      assert.equal(isValid, true);
    }
  });

  it(`gets rejected if cover parameters don't match the signature`, async function () {
    const { qt } = this;
    const sig = QuoteEngine.signQuote(ethQuotationData, qt.address, authQuoteEnginePrivateKey);
    const coverDetails = new Array(5);
    coverDetails[0] = ethQuotationData.amount.toFixed();
    coverDetails[1] = ethQuotationData.price.toFixed();
    coverDetails[2] = ethQuotationData.priceInNXM.toFixed();
    coverDetails[3] = ethQuotationData.expiresAt;
    coverDetails[4] = ethQuotationData.generatedAt;

    const wrongPeriod = 78;
    const isValid = await qt.verifySign(
      coverDetails,
      wrongPeriod,
      hex(ethQuotationData.currency),
      ethQuotationData.contract,
      sig.v,
      sig.r,
      sig.s,
    );
    assert.equal(isValid, false);
  });
});
