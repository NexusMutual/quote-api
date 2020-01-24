const assert = require('assert');
const utils = require('../src/utils');

describe('utils', function () {
  describe('wrap()', function () {

    it('should return an array representing the wrapped string', function () {
      const input = 'abcde';
      const expected = ['ab', 'cd', 'e'];
      const actual = utils.wrap(input, 2);
      assert.deepStrictEqual(actual, expected);
    });

  });
});
