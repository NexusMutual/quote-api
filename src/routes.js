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

  app.get('/getQuote/:coverAmount/:currency/:period/:contractAddress/:version', asyncRoute(async (req, res) => {

    const origin = req.get('origin');
    const apiKey = req.headers['x-api-key'];
    const isAllowed = await quoteEngine.isOriginAllowed(origin, apiKey);

    if (!isAllowed) {
      return res.status(403).send({
        error: true,
        message: 'Origin not allowed. Contact us for an API key',
      });
    }

    const { contractAddress, coverAmount, currency, period } = req.params;
    const quote = await quoteEngine.getQuote(
      contractAddress.toLowerCase(),
      coverAmount,
      currency.toUpperCase(),
      period,
    );

    if (quote === null) {
      return res.send({ error: true, message: 'Unable to create cover on the specified contract' });
    }

    res.send(quote);
  }));

  return app;
};
