class QuoteEngine {

  static getStakes (transactions) {
    return transactions.map(transaction => {

      const stakerAddress = transaction.from;

      return { stakerAddress };
    });
  }

}

module.exports = QuoteEngine;
