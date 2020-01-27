require('dotenv').config();

const app = require('express')();
const mongoose = require('mongoose');
const fetch = require('node-fetch');

const Etherscan = require('./etherscan');
const QuoteEngine = require('./quote-engine');

const {
  API_URL,
  MONGO_URL,
  PROVIDER_URL,
  PORT,
} = process.env;

const etherscan = new Etherscan('ETHERSCAN_API_KEY');
const quoteEngine = new QuoteEngine(etherscan);

const Web3 = require('web3');
const web3 = new Web3(new Web3.providers.HttpProvider(PROVIDER_URL));

let abis;

async function fetchVersionData (chain = 'mainnet') {
  const versionDataURL = `${API_URL}/version-data/data.json`;
  const data = await fetch(versionDataURL).then(res => res.json());

  if (typeof data[chain] === 'undefined') {
    throw new Error(`No data for ${chain} chain found.`);
  }

  return data[chain].abis;
}

async function startServer (app, port) {
  return new Promise(resolve => app.listen(port, resolve));
}

async function init () {
  await mongoose.connect(MONGO_URL, { useNewUrlParser: true });

  console.log('Fetching version data');
  abis = await fetchVersionData();

  await startServer(app, PORT);
  console.log(`Quote engine listening on port ${PORT}`);
}

init()
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
