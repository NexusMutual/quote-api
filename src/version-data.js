const fetch = require('node-fetch');
const Web3 = require('web3');

const {
  WEB3_PROVIDER,
  VERSION_DATA_URL,
} = process.env;

class VersionData {

  constructor (chain = 'mainnet', versionDataURL = VERSION_DATA_URL) {
    this.chain = chain;
    this.versionDataURL = versionDataURL;
  }

  async init () {
    const data = await fetch(this.versionDataURL).then(res => res.json());

    if (typeof data[this.chain] === 'undefined') {
      throw new Error(`No data for ${this.chain} chain found.`);
    }

    this.data = data[this.chain].abis.reduce((data, abi) => ({ ...data, [abi.code]: abi }), {});
    this.web3 = new Web3(WEB3_PROVIDER);
  }

  address (code) {
    return this.data[code].address;
  }

  instance (code) {
    const abi = JSON.parse(this.data[code].contractAbi);
    const address = this.address(code);
    return new this.web3.eth.Contract(abi, address);
  }
}

module.exports = VersionData;
