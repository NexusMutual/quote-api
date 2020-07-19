require('dotenv').config();
const mongoose = require('mongoose');
const QuoteEngine = require('./quote-engine');
const NexusContractLoader = require('./nexus-contract-loader');
const routes = require('./routes');
const log = require('./log');

const {
  MONGO_URL,
  PORT,
  PRIVATE_KEY,
} = process.env;

async function startServer (app, port) {
  return new Promise(resolve => app.listen(port, resolve));
}

async function init () {

  log.info('Connecting to database');
  const opts = { useNewUrlParser: true, useUnifiedTopology: true };
  await mongoose.connect(MONGO_URL, opts);

  log.info('Initializing version data');
  const nexusContractLoader = new NexusContractLoader();
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
