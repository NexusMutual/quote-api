const mongoose = require('mongoose');

const stakeSchema = new mongoose.Schema({
  blockNumber: Number,
  stakerAddress: String,
  contractAddress: String,
  amount: String,
  stakedAt: Date,
});

module.exports = mongoose.model('Stake', stakeSchema);
