const mongoose = require('mongoose');

const quote = new mongoose.Schema({
  amount: String,
  contract: String,
  currency: String,
  expiresAt: Number,
  generatedAt: Number,
  period: String,
  price: String,
  priceInNXM: String,
  v: String,
  r: String,
  s: String,
});

module.exports = mongoose.model('Quote', quote);
