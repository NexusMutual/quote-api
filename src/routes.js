const express = require('express');
const uuid = require('uuid');
const ApiKey = require('./models/api-key');
const log = require('./log');
const QuoteEngine = require('./quote-engine');
const { getWhitelist } = require('./contract-whitelist');
const httpContext = require('express-http-context');
const { QuoteStatus } = require('./enums');

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

    const { error } = QuoteEngine.validateQuoteParameters(
      contractAddress,
      coverAmount,
      currency,
      period,
    );
    if (error) {
      log.error(`Invalid parameters provided: ${error}`);
      return res.status(400).send({
        error: true,
        message: error,
      });
    }
    const whitelist = await getWhitelist();
    if (!whitelist.includes(contractAddress.toLowerCase())) {
      const message = `Contract ${contractAddress} not on whitelist`;
      log.error(message);
      return res.status(400).send({
        error: true,
        message,
      });
    }

    const quote = await quoteEngine.getQuote(
      contractAddress,
      coverAmount,
      currency,
      period,
    );

    res.send(prettyPrintResponse(quote));
  }));

  app.get('/v1/contracts/:contractAddress/capacity', asyncRoute(async (req, res) => {
    const origin = req.get('origin');
    const apiKey = req.headers['x-api-key'];
    const isAllowed = await isOriginAllowed(origin, apiKey);

    if (!isAllowed) {
      return res.status(403).send({
        error: true,
        message: 'Origin not allowed. Contact us for an API key',
      });
    }

    const { contractAddress } = req.params;
    QuoteEngine.validateCapacityParameters();

    const { error } = QuoteEngine.validateCapacityParameters(contractAddress);

    if (error) {
      log.error(`Invalid parameters provided: ${error}`);
      return res.status(400).send({
        error: true,
        message: error,
      });
    }

    const { capacityDAI, capacityETH, netStakedNXM } = await quoteEngine.getCapacity(contractAddress);

    res.send({
      capacityETH: capacityETH.toFixed(0),
      capacityDAI: capacityDAI.toFixed(0),
      netStakedNXM: netStakedNXM.toFixed(0),
    });
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

    const { error } = QuoteEngine.validateQuoteParameters(
      contractAddress,
      coverAmount,
      currency,
      period,
    );
    if (error) {
      log.error(`Invalid parameters provided: ${error}`);
      return res.status(400).send({
        error: true,
        message: error,
      });
    }
    const whitelist = await getWhitelist();
    if (!whitelist.includes(contractAddress.toLowerCase())) {
      const message = `Contract ${contractAddress} not on whitelist.`;
      log.error(message);
      return res.status(400).send({
        reason: 'Uncoverable',
        coverAmount: 0,
      });
    }

    const quote = await quoteEngine.getQuote(
      contractAddress,
      coverAmount,
      currency,
      period,
    );

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
    coverPeriod: r.period.toString(),
    smartCA: r.contract,
    coverAmount: parseInt(r.amount.toFixed(0)),
    coverCurrPrice: r.price.toFixed(0),
    PriceNxm: r.priceInNXM.toFixed(0),
    expireTime: r.expiresAt,
    generationTime: r.generatedAt,
    reason: r.status,
    v: r.v,
    r: r.r,
    s: r.s,
  };

  return legacyResponse;
}

function prettyPrintResponse (r) {
  const prettyResponse = {
    ...r,
    amount: r.amount.toFixed(0),
    price: r.price.toFixed(0),
    priceInNXM: r.priceInNXM.toFixed(0),
    period: r.period.toString(),
  };

  if (prettyResponse.status === QuoteStatus.UNCOVERABLE) {
    prettyResponse.error = 'Uncoverable';
  }
  delete prettyResponse.status;
  return prettyResponse;
}
