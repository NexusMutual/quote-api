const mongoose = require('mongoose');
const COLLECTION = 'smartcoverdetails';

const smartCoverDetails = new mongoose.Schema({
  smartContractAdd: String,
  sumAssured: Number,
  expiry: Date,
  expirytimeStamp: Number,
  statusNum: Number,
  premium: Number,
  premiumNXM: Number,
  curr: String,
  lockCN: String, // TODO: check if this is correct
  coverId: Number,
  blockNumber: Number,
  coverCreation: Date,
  timestamp: Number,
  version: String,
});

module.exports = mongoose.model('SmartCoverDetails', smartCoverDetails, COLLECTION);
