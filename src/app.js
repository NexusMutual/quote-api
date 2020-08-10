require('dotenv').config();

const QuoteEngine = require('./quote-engine');
const routes = require('./routes');
const { getEnv } = require('./utils');

async function initApp () {

  const PRIVATE_KEY = getEnv('PRIVATE_KEY');
  const QT_ADDRESS = getEnv('QT_ADDRESS');
  const quoteEngine = new QuoteEngine(QT_ADDRESS, PRIVATE_KEY);

  return routes(quoteEngine);
}

module.exports = {
  initApp,
};
