const assert = require('assert');

const QuoteEngine = require('../../src/quote-engine');

describe('validateQuoteParameters()', function () {
  const validAddress = '0x2c2bc2cde905b29494cbd485657dae8a95f30ec8';
  it('validates correct ETH input values as valid: true', function () {
    const { valid, error } = QuoteEngine.validateQuoteParameters(validAddress, '1000', 'ETH', '365');
    assert.equal(valid, true, error);
  });

  it('validates correct DAI input values as valid: true', function () {
    const { valid, error } = QuoteEngine.validateQuoteParameters(validAddress, '1000', 'DAI', '30');
    assert.equal(valid, true, error);
  });

  it('validates incorrect address as valid: false', function () {
    const { valid } = QuoteEngine.validateQuoteParameters('BLA' + validAddress, '1000', 'ETH', '45');
    assert.equal(valid, false);
  });

  it('validates incorrect amount as valid: false', function () {
    const { valid } = QuoteEngine.validateQuoteParameters(validAddress, 'abc', 'ETH', '45');
    assert.equal(valid, false);
  });
  it('validates incorrect fractional amount as valid: false', function () {
    const { valid } = QuoteEngine.validateQuoteParameters(validAddress, '125.5', 'ETH', '45');
    assert.equal(valid, false);
  });

  it('validates incorrect negative amount as valid: false', function () {
    const { valid } = QuoteEngine.validateQuoteParameters(validAddress, '-125', 'ETH', '45');
    assert.equal(valid, false);
  });

  it('validates incorrect currency as valid: false', function () {
    const { valid } = QuoteEngine.validateQuoteParameters(validAddress, '1000', 'BLA', '45');
    assert.equal(valid, false);
  });

  it('validates incorrect period as valid: false', function () {
    const { valid } = QuoteEngine.validateQuoteParameters(validAddress, '1000', 'DAI', '366');
    assert.equal(valid, false);
  });
});
