require('dotenv').config();

const mongoose = require('mongoose');

const Etherscan = require('./etherscan');
const QuoteEngine = require('./quote-engine');
const App = require('./app');
const VersionData = require('./version-data');

const {
  MONGO_URL,
  PORT,
} = process.env;

async function startServer (app, port) {
  return new Promise(resolve => app.listen(port, resolve));
}

async function init () {
  console.log('Connecting to database');
  const opts = { useNewUrlParser: true, useUnifiedTopology: true };
  await mongoose.connect(MONGO_URL, opts);

  console.log('Initializing version data');
  const versionData = new VersionData();
  await versionData.init();

  const etherscan = new Etherscan();
  const quoteEngine = new QuoteEngine(etherscan, versionData);

  console.log('Fetching past data');
  await quoteEngine.fetchNewStakes();

  const app = App(quoteEngine);
  await startServer(app, PORT);

  console.log(`Quote engine listening on port ${PORT}`);
}

init()
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
