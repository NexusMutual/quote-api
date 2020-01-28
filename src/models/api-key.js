const mongoose = require('mongoose');

const apiKeySchema = new mongoose.Schema({
  apiKey: String,
  origin: String,
});

module.exports = mongoose.model('ApiKey', apiKeySchema);
