require('dotenv').config();
const assert = require('assert');
const Decimal = require('decimal.js');
const request = require('supertest');
const { initApp } = require('../../src/app');

const MongoMemoryServer = require('mongodb-memory-server').MongoMemoryServer;
const mongoose = require('mongoose');
mongoose.Promise = Promise;

describe('GET /v1/quote', function () {
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
  it('responds with a valid quote for a production contract', async function () {
    const coverAmount = '1000';
    const currency = 'ETH';
    const period = 100;
    const contractAddress = '0x4Ddc2D193948926D02f9B1fE9e1daa0718270ED5'; // Compound

    const { status, body } = await request(app).get(
      `/v1/quote?coverAmount=${coverAmount}&currency=${currency}&period=${period}&contractAddress=${contractAddress}`,
    );
    assert.equal(status, 200);
  });
});
