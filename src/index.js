require('dotenv').config();
const log = require('./log');
const { getEnv } = require('./utils');
const { initApp } = require('./app');

async function startServer (app, port) {
  return new Promise(resolve => app.listen(port, resolve));
}

async function init () {

  const PORT = getEnv('PORT');
  const app = await initApp();

  await startServer(app, PORT);
  log.info(`Quote engine listening on port ${PORT}`);
}

init()
  .catch(error => {
    log.error(`Unhandled app error: ${error}`);
    process.exit(1);
  });
