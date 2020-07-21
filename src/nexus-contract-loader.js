const axios = require('axios');
const log = require('./log');
const { setupLoader } = require('@openzeppelin/contract-loader');

class NexusContractLoader {

  constructor (chain, versionDataURL, provider) {
    this.chain = chain;
    this.versionDataURL = versionDataURL;
    this.provider = provider;
  }

  async init () {
    log.info(`Fetching version data from ${this.versionDataURL} for network ${this.chain}`);
    const { data } = await axios.get(this.versionDataURL);

    if (typeof data[this.chain] === 'undefined') {
      throw new Error(`No data for ${this.chain} chain found.`);
    }

    this.data = data[this.chain].abis
      .reduce((data, abi) => ({ ...data, [abi.code]: { ...abi, contractAbi: JSON.parse(abi.contractAbi) } }), {});

    this.loader = setupLoader({
      provider: this.provider,
    }).truffle;
  }

  address (code) {
    return this.data[code].address;
  }

  instance (code) {
    const abi = this.data[code].contractAbi;
    const address = this.address(code);
    return this.loader.fromABI(abi, null, address);
  }
}

module.exports = NexusContractLoader;
