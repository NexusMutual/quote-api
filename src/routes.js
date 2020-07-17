const express = require('express');

const asyncRoute = route => (req, res) => {
  route(req, res).catch(e => {
    console.error('Route error:', e);
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
    console.log(`${req.method} ${req.originalUrl}`);
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'x-api-key');
    next();
  });

  app.get('/quotes', asyncRoute(async (req, res) => {

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
