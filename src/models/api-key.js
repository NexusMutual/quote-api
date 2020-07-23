const mongoose = require('mongoose');
const { API_KEY_COLLECTION } = process.env;

const apiKeySchema = new mongoose.Schema({
  apiKey: String,
  origin: String,
});

module.exports = mongoose.model('ApiKey', apiKeySchema, API_KEY_COLLECTION);
