require('dotenv').config();
const assert = require('assert');
const Decimal = require('decimal.js');
const request = require('supertest');
const { initApp } = require('../../src/app');

const MongoMemoryServer = require('mongodb-memory-server').MongoMemoryServer;
const mongoose = require('mongoose');
mongoose.Promise = Promise;

describe('GET quotes', function () {
  const PORT = 3000;

  this.timeout(300000);
  let app;
  before(async function () {

    const mongod = new MongoMemoryServer();
    const uri = await mongod.getUri();
    process.env.PROVIDER_URL = 'https://parity.nexusmutual.io';
    process.env.VERSION_DATA_URL = 'https://api.nexusmutual.io/version-data/data.json';
    process.env.NETWORK = 'mainnet';
    process.env.PRIVATE_KEY = '45571723d6f6fa704623beb284eda724459d76cc68e82b754015d6e7af794cc8';
    process.env.MONGO_URL = uri;
    app = await initApp();
    await new Promise(resolve => app.listen(PORT, resolve));
  });

  describe('GET /v1/quote', function () {
    it('responds with a valid quote for a production contract', async function () {
      const coverAmount = '1000';
      const currency = 'ETH';
      const period = 100;
      const contractAddress = '0x86969d29F5fd327E1009bA66072BE22DB6017cC6';

      const { status, body } = await request(app).get(
        `/v1/quote?coverAmount=${coverAmount}&currency=${currency}&period=${period}&contractAddress=${contractAddress}`,
      );
      assert.equal(status, 200);
      assert.equal(body.currency, 'ETH');
      assert.equal(body.amount, coverAmount);
      assert.equal(body.contract.toLowerCase(), contractAddress.toLowerCase());
      assert.equal(body.period, period);
      assert.equal(isNaN(parseInt(body.price)), false);
      assert.equal(isNaN(parseInt(body.priceInNXM)), false);
      assert.equal(isNaN(parseInt(body.expiresAt)), false);
      assert.equal(isNaN(parseInt(body.generatedAt)), false);
      console.log(body);
    });

    it('responds with 400 for a non-whitelisted contract',  async function () {
      const coverAmount = '1000';
      const currency = 'ETH';
      const period = 100;
      const contractAddress = '0xd7c49cee7e9188cca6ad8ff264c1da2e69d4cf3b'; // NXM Token

      const { status } = await request(app).get(
        `/v1/quote?coverAmount=${coverAmount}&currency=${currency}&period=${period}&contractAddress=${contractAddress}`,
      );
      assert.equal(status, 400);
    });
  });

  describe('GET /getQuote', function () {
    it('responds with a valid quote for a production contract', async function () {
      const coverAmount = '1000';
      const currency = 'ETH';
      const period = 100;
      const contractAddress = '0x86969d29F5fd327E1009bA66072BE22DB6017cC6';

      const { status, body } = await request(app).get(
        `/getQuote/${coverAmount}/${currency}/${period}/${contractAddress}/M1`,
      );

      assert.equal(status, 200);
      assert.equal(body.coverCurr, 'ETH');
      assert.equal(body.coverAmount, coverAmount);
      assert.equal(body.smartCA.toLowerCase(), contractAddress.toLowerCase());
      assert.equal(body.coverPeriod, period);
      assert.equal(body.reason, 'ok');
      assert.equal(isNaN(parseInt(body.coverCurrPrice)), false);
      assert.equal(isNaN(parseInt(body.PriceNxm)), false);
      assert.equal(isNaN(parseInt(body.expireTime)), false);
      assert.equal(isNaN(parseInt(body.generationTime)), false);
      console.log(body);
    });
  });
});
