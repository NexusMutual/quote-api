const express = require('express');
const uuid = require('uuid');
const ApiKey = require('./models/api-key');
const log = require('./log');
const QuoteEngine = require('./quote-engine');
const { getWhitelist } = require('./contract-whitelist');
const httpContext = require('express-http-context');

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

  // use context for request id logging.
  app.use(httpContext.middleware);
  // Run the context for each request. Assign a unique identifier to each request
  app.use((req, res, next) => {
    httpContext.set('reqId', uuid.v1());
    next();
  });

  app.use((req, res, next) => {
    log.info(`${req.method} ${req.originalUrl}`);
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'x-api-key');
    next();
  });

  app.get('/v1/quote', asyncRoute(async (req, res) => {
    const origin = req.get('origin');
    const apiKey = req.headers['x-api-key'];
    const isAllowed = await isOriginAllowed(origin, apiKey);

    if (!isAllowed) {
      return res.status(403).send({
        error: true,
        message: 'Origin not allowed. Contact us for an API key',
      });
    }
    const coverAmount = req.query.coverAmount;
    const currency = req.query.currency;
    const period = req.query.period;
    const contractAddress = req.query.contractAddress;

    const { valid, error } = QuoteEngine.validateQuoteParameters(
      contractAddress,
      coverAmount,
      currency,
      period,
    );
    if (!valid) {
      log.error(`Invalid parameters provided: ${error}`);
      return res.status(400).send({
        error: true,
        message: error,
      });
    }
    const whitelist = await getWhitelist();
    if (!whitelist.includes(contractAddress.toLowerCase())) {
      const message = `Contract ${contractAddress} not on whitelist: ${error}`;
      log.error(message);
      return res.status(400).send({
        error: true,
        message: error,
      });
    }

    const quote = await quoteEngine.getQuote(
      contractAddress,
      coverAmount,
      currency,
      period,
    );

    if (quote === null) {
      return res.status(400).send({ error: true, message: 'Unable to create cover on the specified contract' });
    }
    res.send(quote);
  }));

  /**
   * legacy endpoint.
   */
  app.get('/getQuote/:coverAmount/:currency/:period/:contractAddress/:version', asyncRoute(async (req, res) => {

    const origin = req.get('origin');
    const apiKey = req.headers['x-api-key'];
    const isAllowed = await isOriginAllowed(origin, apiKey);

    if (!isAllowed) {
      return res.status(403).send({
        error: true,
        message: 'Origin not allowed. Contact us for an API key',
      });
    }

    const { contractAddress, coverAmount, currency, period } = req.params;
    const quote = await quoteEngine.getQuote(
      contractAddress,
      coverAmount,
      currency,
      period,
    );

    if (quote === null) {
      return res.send({ error: true, message: 'Unable to create cover on the specified contract' });
    }

    res.send(toLegacyFormatResponse(quote));
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

  const storedApiKey = await ApiKey.findOne({ origin, apiKey });

  return storedApiKey !== null;
}

function toLegacyFormatResponse (r) {
  const legacyResponse = {
    coverCurr: r.currency,
    coverPeriod: r.period,
    smartCA: r.contract,
    coverAmount: r.amount,
    coverCurrPrice: r.price,
    PriceNxm: r.priceInNXM,
    expireTime: r.expiresAt,
    generationTime: r.generatedAt,
    v: r.v,
    r: r.r,
    s: r.s,
  };

  if (!r.error) {
    legacyResponse.reason = 'ok';
  }

  return legacyResponse;
}
