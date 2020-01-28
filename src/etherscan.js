const fetch = require('node-fetch');

const ETHERSCAN_URL = {
  mainnet: 'https://api.etherscan.io/api',
  kovan: 'https://api-kovan.etherscan.io/api',
  rinkeby: 'https://api-rinkeby.etherscan.io/api',
  ropsten: 'https://api-ropsten.etherscan.io/api',
};

const { ETHERSCAN_API_KEY } = process.env;

class Etherscan {

  constructor (apiKey = null, chain = 'mainnet') {
    this.apiURL = ETHERSCAN_URL[chain];
    this.apiKey = apiKey || ETHERSCAN_API_KEY;
  }

  async request (module, action, address, options) {
    const { apiKey } = this;
    const params = { module, action, address, ...options, apiKey };
    const qs = new URLSearchParams(params).toString();
    const url = `${this.apiURL}?${qs}`;
    const response = await fetch(url).then(r => r.json());
    const successful = ['OK', 'No transactions found'];

    if (response.message && successful.indexOf(response.message) === -1) {
      throw new Error(`API error: ${JSON.stringify(response)}`);
    }

    return response;
  }

  async getTransactions (address, opts = {}) {
    const { result } = await this.request('account', 'txlist', address, { sort: 'asc', ...opts });
    return result;
  }
}

module.exports = Etherscan;
