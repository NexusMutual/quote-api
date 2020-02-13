require('dotenv').config();

const fs = require('fs');
const MongoClient = require('mongodb').MongoClient;

const { MONGO_URL } = process.env;
const DB = 'nexusmutual_db';

async function dump () {

  const now = new Date();
  const month = (now.getMonth() + 1).toString().padStart(2, '0');
  const day = now.getDate().toString().padStart(2, '0');
  const hour = now.getHours().toString().padStart(2, '0');
  const minute = now.getMinutes().toString().padStart(2, '0');
  const seconds = now.getSeconds().toString().padStart(2, '0');

  const filename = `quote_export_${month}-${day}-${hour}-${minute}-${seconds}.csv`;
  const connection = await MongoClient.connect(MONGO_URL, { useNewUrlParser: true, useUnifiedTopology: true });
  const items = await connection.db(DB).collection('quotes').find().toArray();

  const headers = [
    'timestamp', 'datetime', 'contract', 'cover_amount', 'cover_currency', 'cover_period',
    'v1_reason', 'v1_cover_amount', 'v1_price_in_cover_currency', 'v1_price_in_nxm',
    'v2_reason', 'v2_cover_amount', 'v2_price_in_cover_currency', 'v2_price_in_nxm',
  ];

  fs.writeFileSync(filename, headers.join(',') + '\n');

  for (const item of items) {
    const { quote, quoteV2 } = item;
    const line = [
      quote.generationTime,
      JSON.stringify(new Date(quote.generationTime).toLocaleString('en', { timeZone: 'UTC' })),
      // inputs
      quote.smartCA,
      quote.coverAmount,
      quote.coverCurr,
      quote.coverPeriod,
      // outputs v1
      JSON.stringify(quote.reason),
      quote.coverAmount,
      ((quote.coverCurrPrice || 0) / 1e18).toFixed(4),
      ((quote.PriceNxm || 0) / 1e18).toFixed(4),
      // outputs v2
      JSON.stringify(quoteV2.reason),
      quoteV2.coverAmount,
      ((quoteV2.coverCurrPrice || 0) / 1e18).toFixed(4),
      ((quoteV2.PriceNxm || 0) / 1e18).toFixed(4),
    ];
    fs.appendFileSync(filename, line.join(',') + '\n');
  }

  console.log(`Data written to ${filename}`);
  console.log('Have a nice day! o/');
  process.exit();
}

dump().catch(e => {
  console.error('Failed to dump quotes to csv', e);
  process.exit(1);
});
