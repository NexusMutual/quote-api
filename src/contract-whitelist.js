const NodeCache = require('node-cache');
const axios = require('axios');
const log = require('./log');

const cache = new NodeCache({ stdTTL: 60, checkperiod: 120 });

const WHITELIST_KEY = 'whitelist';

async function getWhitelist () {

  let whitelist = cache.get(WHITELIST_KEY);
  if (!whitelist) {
    whitelist = [];
    const { data } = await axios.get('https://api.nexusmutual.io/coverables/contracts.json');
    for (const address of Object.keys(data)) {
      if (!data[address].disabled) {
        whitelist.push(address.toLowerCase());
      }
    }
    cache.set(WHITELIST_KEY, whitelist);
    log.info(`Fetched and cached whitelist of length: ${whitelist.length}`);
  }
  return whitelist;
}

module.exports = {
  getWhitelist,
};
