const Decimal = require('decimal.js');

class ActiveCover {
  constructor (contractAddress, sumAssured, currency) {
    this.contractAddress = contractAddress;
    this.sumAssured = Decimal(sumAssured);
    this.currency = currency;
  }
}

module.exports = ActiveCover;
