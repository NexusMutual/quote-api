require('dotenv').config();
const mongoose = require('mongoose');
const Web3 = require('web3');
const QuoteEngine = require('./quote-engine');
const NexusContractLoader = require('./nexus-contract-loader');
const routes = require('./routes');
const log = require('./log');

function getEnv (key, fallback = false) {

  const value = process.env[key] || fallback;

  if (!value) {
    throw new Error(`Missing env var: ${key}`);
  }

  return value;
}

async function startServer (app, port) {
  return new Promise(resolve => app.listen(port, resolve));
}

async function init () {

  const PORT = getEnv('PORT');
  const PROVIDER_URL = getEnv('PROVIDER_URL');
  const VERSION_DATA_URL = getEnv('VERSION_DATA_URL');
  const PRIVATE_KEY = getEnv('PRIVATE_KEY');
  const NETWORK = getEnv('NETWORK', 'mainnet');
  const MONGO_URL = getEnv('MONGO_URL', 'mainnet');

  log.info(`Connecting to node at ${PROVIDER_URL}..`);
  const web3 = new Web3(PROVIDER_URL);
  await web3.eth.net.isListening();

  log.info('Connecting to database');
  const opts = { useNewUrlParser: true, useUnifiedTopology: true };
  await mongoose.connect(MONGO_URL, opts);

  log.info('Initializing NexusContractLoader..');
  const nexusContractLoader = new NexusContractLoader(NETWORK, VERSION_DATA_URL,  web3.eth.currentProvider);
  await nexusContractLoader.init();

  const quoteEngine = new QuoteEngine(nexusContractLoader, PRIVATE_KEY);
  log.info(`Quote engine listening on port ${PORT}`);
  const app = routes(quoteEngine);
  await startServer(app, PORT);
}

init()
  .catch(error => {
    log.error(`Unhandled app error: ${error}`);
    process.exit(1);
  });
