const express = require('express');
const ApiKey = require('./models/api-key');
const log = require('./log');

const asyncRoute = route => (req, res) => {
  route(req, res).catch(e => {
    log.error(`Route error: ${e.stack}`);
    res.status(500).send({
      error: true,
      message: 'Internal server error',
    });
  });
};

/**
 * @param {QuoteEngine} quoteEngine
 * @return {app}
 */
module.exports = quoteEngine => {

  const app = express();

  app.use((req, res, next) => {
    log.info(`${req.method} ${req.originalUrl}`);
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'x-api-key');
    next();
  });

  app.get('/quotes', asyncRoute(async (req, res) => {
    const origin = req.get('origin');
    const apiKey = req.headers['x-api-key'];
    const isAllowed = await isOriginAllowed(origin, apiKey);

    if (!isAllowed) {
      return res.status(403).send({
        error: true,
        message: 'Origin not allowed. Contact us for an API key',
      });
    }

    const coverAmount = parseInt(req.query.coverAmount);
    const currency = req.query.currency;
    const period = parseInt(req.query.period);
    const contractAddress = req.query.contractAddress;

    const quote = await quoteEngine.getQuote(
      contractAddress.toLowerCase(),
      coverAmount,
      currency.toUpperCase(),
      period,
    );

    if (quote === null) {
      return res.status(400).send({ error: true, message: 'Unable to create cover on the specified contract' });
    }
    res.send(quote);
  }));

  return app;
};

async function isOriginAllowed (origin, apiKey) {

  if (/\.nexusmutual\.io$/.test(origin)) {
    return true;
  }

  if (!apiKey) { // null, undefined, etc
    return false;
  }

  apiKey = await ApiKey.findOne({ origin, apiKey });

  return apiKey !== null;
}
