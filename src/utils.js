const Big = require('big.js');

function wrap (text, length) {
  const regex = new RegExp(`.{1,${length}}`, 'g');
  return text.match(regex);
}

/**
 * Returns the minimum of two numbers
 * Input can be big.js instance, string, or number
 * @param {(Big|string|number)} a
 * @param {(Big|string|number)} b
 * @return {Big}
 */
function min (a, b) {
  const bigA = Big(a);
  const bigB = Big(b);
  return bigA.lt(bigB) ? bigA : bigB;
}

/**
 * Returns maximum of two big.js numbers
 * @param {(Big|string|number)} a
 * @param {(Big|string|number)} b
 * @return {Big}
 */
function max (a, b) {
  const bigA = Big(a);
  const bigB = Big(b);
  return bigA.gt(bigB) ? bigA : bigB;
}

const hex = string => '0x' + Buffer.from(string).toString('hex');

module.exports = {
  wrap,
  min,
  max,
  hex
};
