require('dotenv').config();
const mongoose = require('mongoose');
const Web3 = require('web3');
const QuoteEngine = require('./quote-engine');
const NexusContractLoader = require('./nexus-contract-loader');
const routes = require('./routes');
const log = require('./log');
const { getEnv } = require('./utils');

async function initApp () {
  const PROVIDER_URL = getEnv('PROVIDER_URL');
  const VERSION_DATA_URL = getEnv('VERSION_DATA_URL');
  const PRIVATE_KEY = getEnv('PRIVATE_KEY');
  const NETWORK = getEnv('NETWORK', 'mainnet');
  const MONGO_URL = getEnv('MONGO_URL', 'mainnet');
  const CAPACITY_FACTOR_END_DATE = getEnv('CAPACITY_FACTOR_END_DATE', 'mainnet');
  const QUOTE_SIGN_MIN_INTERVAL_SECONDS = parseInt(getEnv('QUOTE_SIGN_MIN_INTERVAL_SECONDS'));
  const ENABLE_CAPACITY_RESERVATION = parseInt(getEnv('ENABLE_CAPACITY_RESERVATION', '0'));

  log.info(JSON.stringify({
    VERSION_DATA_URL,
    NETWORK,
    CAPACITY_FACTOR_END_DATE,
    QUOTE_SIGN_MIN_INTERVAL_SECONDS,
    ENABLE_CAPACITY_RESERVATION,
  }));

  log.info(`Connecting to node at ${new URL(PROVIDER_URL).origin}..`);
  const web3 = new Web3(PROVIDER_URL);
  await web3.eth.net.isListening();

  log.info('Connecting to database..');
  const opts = { useNewUrlParser: true, useUnifiedTopology: true };
  await mongoose.connect(MONGO_URL, opts);

  log.info('Initializing NexusContractLoader..');
  const nexusContractLoader = new NexusContractLoader(NETWORK, VERSION_DATA_URL, web3.eth.currentProvider);
  await nexusContractLoader.init();

  const enableCapacityReservation = !isNaN(ENABLE_CAPACITY_RESERVATION) && ENABLE_CAPACITY_RESERVATION > 0;

  log.info('Initializing quote engine..');
  const quoteEngine = new QuoteEngine(
    nexusContractLoader,
    PRIVATE_KEY,
    web3,
    CAPACITY_FACTOR_END_DATE,
    enableCapacityReservation,
  );

  return routes(quoteEngine);
}

module.exports = {
  initApp,
};
