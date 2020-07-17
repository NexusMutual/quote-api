const axios = require('axios');

async function getWhitelist() {
  const { data } = await axios.get('https://api.nexusmutual.io/coverables/contracts.json');
  return Object.keys(data);
}

module.exports = {
  getWhitelist
}
