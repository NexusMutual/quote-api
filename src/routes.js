const express = require('express');
const uuid = require('uuid');
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

    res.send({
      ...quote,
      amount: quote.amount.toFixed(0),
      price: quote.price.toFixed(0),
      priceInNXM: quote.priceInNXM.toFixed(0),
      period: quote.period.toString(),
    });
  }));

  app.get('/v1/contracts/:contractAddress/capacity', asyncRoute(async (req, res) => {

    return res.status(405).send({ error: 'not implemented' });

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

  return app;
};
