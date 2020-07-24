const mongoose = require('mongoose');
const COLLECTION = 'smartcoverdetails';

const cover = new mongoose.Schema({
  smartContractAdd: String,
  sumAssured: Number,
  expiry: Date,
  expirytimeStamp: Number,
  statusNum: Number,
  premium: Number,
  premiumNXM: Number,
  curr: String,
  lockCN: String,
  coverId: Number,
  blockNumber: Number,
  coverCreation: Date,
  timestamp: Number,
  version: String,
});

module.exports = mongoose.model('Cover', cover, COLLECTION);
