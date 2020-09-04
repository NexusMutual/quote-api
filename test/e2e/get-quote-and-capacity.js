require('dotenv').config();
const assert = require('assert');
const request = require('supertest');
const fetch = require('node-fetch');
const Decimal = require('decimal.js');
const { initApp } = require('../../src/app');
const { ApiKey, Cover } = require('../../src/models');
const { covers } = require('./smarcoverdetails-test-data');
const { getWhitelist } = require('../../src/contract-whitelist');

const MongoMemoryServer = require('mongodb-memory-server').MongoMemoryServer;
const mongoose = require('mongoose');
mongoose.Promise = Promise;

function chunk (arr, chunkSize) {
  const chunks = [];
  let i = 0;
  const n = arr.length;

  while (i < n) {
    chunks.push(arr.slice(i, i + chunkSize));
    i += chunkSize;
  }
  return chunks;
}

describe('GET quotes', function () {
  const PORT = 3000;

  this.timeout(300000);
  let app;
  const API_KEY = 'my_magical_key';
  const ORIGIN = 'my_magical_origin';

  async function requestQuote (amount, currency, period, contractAddress) {
    const response = await request(app)
      .get(
        `/v1/quote?coverAmount=${amount}&currency=${currency}&period=${period}&contractAddress=${contractAddress}`,
      )
      .set({ 'x-api-key': API_KEY, origin: ORIGIN });
    return response;
  }

  async function requestCapacity (contractAddress) {
    const response = await request(app)
      .get(`/v1/contracts/${contractAddress}/capacity`)
      .set({ 'x-api-key': API_KEY, origin: ORIGIN });
    return response;
  }

  before(async function () {

    const mongod = new MongoMemoryServer();
    const uri = await mongod.getUri();
    const opts = { useNewUrlParser: true, useUnifiedTopology: true };
    await mongoose.connect(uri, opts);

    process.env.PROVIDER_URL = 'https://parity.nexusmutual.io';
    process.env.VERSION_DATA_URL = 'https://api.nexusmutual.io/version-data/data.json';
    process.env.NETWORK = 'mainnet';
    process.env.PRIVATE_KEY = '45571723d6f6fa704623beb284eda724459d76cc68e82b754015d6e7af794cc8';
    process.env.MONGO_URL = uri;
    process.env.CAPACITY_FACTOR_END_DATE = '08/10/2020';

    await ApiKey.create({ apiKey: API_KEY, origin: ORIGIN });

    app = await initApp();
    await new Promise(resolve => app.listen(PORT, resolve));
  });

  afterEach(async function () {
    try {
      await Cover.collection.drop();
    } catch (e) {
      console.log(`Error in afterEach: ${e}`);
    }
  });

  describe('GET /v1/contracts/:contractAddress/capacity', async function () {
    it('responds with 200 for a production contract', async function () {
      const contractAddress = '0x79a8C46DeA5aDa233ABaFFD40F3A0A2B1e5A4F27';
      const dependantContract = '0x7fC77b5c7614E1533320Ea6DDc2Eb61fa00A9714'.toLowerCase();
      const smartCoverDetailsList = covers();
      smartCoverDetailsList.forEach(cover => {
        // eslint-disable-next-line
        cover.smartContractAdd = dependantContract;
      });
      await Cover.insertMany(smartCoverDetailsList);
      const { status, body } = await requestCapacity(contractAddress);
      assert(Decimal(body.capacityETH).isInteger());
      assert(Decimal(body.capacityDAI).isInteger());
      assert(Decimal(body.netStakedNXM).isInteger());
      assert.strictEqual(body.capacityLimit, 'MCR_CAPACITY');
      assert.strictEqual(status, 200);
    });

    it('responds with 200 for a production contract with a defined MCR factor', async function () {
      const contractAddress = '0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f';
      const smartCoverDetailsList = covers();
      smartCoverDetailsList.forEach(cover => {
        // eslint-disable-next-line
        cover.smartContractAdd = contractAddress;
      });
      await Cover.insertMany(smartCoverDetailsList);
      const { status, body } = await requestCapacity(contractAddress);
      assert(Decimal(body.capacityETH).isInteger());
      assert(Decimal(body.capacityDAI).isInteger());
      assert(Decimal(body.netStakedNXM).isInteger());
      assert.strictEqual(body.capacityLimit, 'MCR_CAPACITY');
      assert.strictEqual(status, 200);
    });
  });

  describe('GET /getQuote', function () {
    it('responds with a valid quote for a production contract', async function () {
      const coverAmount = '1000';
      const currency = 'ETH';
      const period = 100;
      const contractAddress = '0x3d9819210A31b4961b30EF54bE2aeD79B9c9Cd3B';
      const smartCoverDetailsList = covers();
      smartCoverDetailsList.forEach(cover => {
        // eslint-disable-next-line
        cover.smartContractAdd = contractAddress;
      });
      await Cover.insertMany(smartCoverDetailsList);

      const { status, body } = await request(app)
        .get(`/getQuote/${coverAmount}/${currency}/${period}/${contractAddress}/M1`)
        .set({ 'x-api-key': API_KEY, origin: ORIGIN });

      assert.strictEqual(status, 200);
      assert.strictEqual(body.coverCurr, 'ETH');
      assert.strictEqual(body.coverAmount, parseInt(coverAmount));
      assert.strictEqual(body.smartCA.toLowerCase(), contractAddress.toLowerCase());
      assert.strictEqual(body.coverPeriod, period.toString());
      assert.strictEqual(body.reason, 'ok');
      assert(Decimal(body.coverCurrPrice).isInteger());
      assert(Decimal(body.PriceNxm).isInteger());
      assert(Number.isInteger(body.expireTime));
      assert(Number.isInteger(body.generationTime));
    });
  });

  describe('GET /v1/capacities', async function () {
    it('responds with 200 when called and  with the correct number of contracts', async function () {
      const whitelist = await getWhitelist();
      const expectedCapacitiesLength = Object.keys(whitelist).length;
      const { status, body } = await request(app)
        .get(`/v1/capacities`)
        .set({ 'x-api-key': API_KEY, origin: ORIGIN });

      assert.strictEqual(status, 200);
      assert.strictEqual(body.length, expectedCapacitiesLength);

      const firstCapacity = body[0];
      assert(Decimal(firstCapacity.capacityETH).isInteger());
      assert(Decimal(firstCapacity.capacityDAI).isInteger());
      assert(Decimal(firstCapacity.netStakedNXM).isInteger());
      assert(firstCapacity.contractAddress);
    });
  });

  describe('GET /v1/quote', function () {
    it('responds with a valid quote for a production contract for ETH', async function () {
      const coverAmount = '1000';
      const currency = 'ETH';
      const period = 100;
      const contractAddress = '0x3d9819210A31b4961b30EF54bE2aeD79B9c9Cd3B';
      const smartCoverDetailsList = covers();
      smartCoverDetailsList.forEach(cover => {
        // eslint-disable-next-line
        cover.smartContractAdd = contractAddress;
      });
      await Cover.insertMany(smartCoverDetailsList);

      const { status, body } = await requestQuote(coverAmount, currency, period, contractAddress);
      assert.strictEqual(status, 200);
      assert.strictEqual(body.currency, 'ETH');
      assert.strictEqual(body.amount, coverAmount);
      assert.strictEqual(body.contract.toLowerCase(), contractAddress.toLowerCase());
      assert.strictEqual(body.period, period.toString());
      assert(Decimal(body.price).isInteger());
      assert(Decimal(body.priceInNXM).isInteger());
      assert(Decimal(body.expiresAt).isInteger());
      assert(Decimal(body.generatedAt).isInteger());
    });

    it('responds with a valid quote for a production contract for DAI', async function () {
      const coverAmount = '20000';
      const currency = 'DAI';
      const period = 100;
      const contractAddress = '0x3d9819210A31b4961b30EF54bE2aeD79B9c9Cd3B';
      const smartCoverDetailsList = covers();
      smartCoverDetailsList.forEach(cover => {
        // eslint-disable-next-line
        cover.smartContractAdd = contractAddress;
      });
      await Cover.insertMany(smartCoverDetailsList);

      const { status, body } = await requestQuote(coverAmount, currency, period, contractAddress);
      assert.strictEqual(status, 200);
      assert.strictEqual(body.currency, 'DAI');
      assert.strictEqual(body.amount, coverAmount);
      assert.strictEqual(body.contract.toLowerCase(), contractAddress.toLowerCase());
      assert.strictEqual(parseInt(body.period), period);
      assert.strictEqual(isNaN(parseInt(body.price)), false);
      assert.strictEqual(isNaN(parseInt(body.priceInNXM)), false);
      assert(Decimal(body.expiresAt).isInteger());
      assert(Decimal(body.generatedAt).isInteger());
    });

    it('responds with 400 for a non-whitelisted contract', async function () {
      const coverAmount = '1000';
      const currency = 'ETH';
      const period = 100;
      const contractAddress = '0xd7c49cee7e9188cca6ad8ff264c1da2e69d4cf3b'; // NXM Token
      const { status } = await requestQuote(coverAmount, currency, period, contractAddress);
      assert.strictEqual(status, 400);
    });

    it('responds with 200 for all currently whitelisted contracts for ETH and DAI quotes', async function () {
      const whitelistArray = [];
      const whitelist = await getWhitelist();
      for (const address of Object.keys(whitelist)) {
        if (!whitelist[address].deprecated) {
          whitelist[address] = { ...whitelist[address], address };
          whitelistArray.push(whitelist[address]);
        }
      }
      const ethCoverAmount = '100';
      const daiCoverAmount = '100';
      const period = 100;

      const chunks = chunk(whitelistArray, 1);
      const results = [];
      for (const chunk of chunks) {

        await Promise.all(chunk.map(async contract => {

          let { status, body } = await requestQuote(ethCoverAmount, 'ETH', period, contract.address);
          assert.strictEqual(status, 200, `Failed for ${JSON.stringify(contract)}`);
          results.push({ ...body, ...contract });

          const response = await requestQuote(daiCoverAmount, 'DAI', period, contract.address);
          status = response.status;
          body = response.body;
          assert.strictEqual(status, 200, `Failed for ${JSON.stringify(contract)}`);
          results.push({ ...body, ...contract });
        }));
      }
      console.log(results);
    });
  });
});
