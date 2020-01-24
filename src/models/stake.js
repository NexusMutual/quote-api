const mongoose = require('mongoose');

module.exports = mongoose.model('Stake', {
  stakerAddress: String,
  contractAddress: String,
  amount: String,
  stackedAt: Date,
});
