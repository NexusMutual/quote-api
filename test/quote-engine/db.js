// Currently not used

const assert = require('assert');
const MongoMemoryServer = require('mongodb-memory-server').MongoMemoryServer;
const mongoose = require('mongoose');

const QuoteEngine = require('../../src/quote-engine');
const Stake = require('../../src/models/stake');
const stakesFixture = require('../fixtures/stakes');

mongoose.Promise = Promise;

async function prepare () {
  const mongod = new MongoMemoryServer();
  const uri = await mongod.getUri();
  const opts = { useNewUrlParser: true, useUnifiedTopology: true };
  await mongoose.connect(uri, opts);
}

async function populate () {
  await Stake.deleteMany({}).exec();
  const stakeData = stakesFixture.map(stake => ({ ...stake, stakedAt: new Date(stake.stakedAt * 1000) }));
  await Stake.insertMany(stakeData);
}

describe('getStakes()', function () {

  before(async function () {
    await prepare();
  });

  beforeEach(async function () {
    await populate();
  });

  it('skips failed transactions', async function () {
    console.log('...');
    assert(true);
  });

});
