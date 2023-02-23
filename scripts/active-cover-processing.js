require('dotenv').config();

const fetch = require('node-fetch');
const Web3 = require('web3');

const log = require('../src/log');
const CoverAmountTracker = require('../src/cover-amount-tracker');
const NexusContractLoader = require('../src/nexus-contract-loader');
const { getEnv } = require('../src/utils');

const CONTRACTS_URL = 'https://api.nexusmutual.io/coverables/contracts.json';
const hex = string => '0x' + Buffer.from(string).toString('hex');

function createBatches (items, batchSize) {
  const batches = [];
  const copy = [...items];
  while (copy.length > 0) {
    batches.push(copy.splice(0, batchSize));
  }
  return batches;
}

async function main () {
  const PROVIDER_URL = getEnv('PROVIDER_URL');
  const VERSION_DATA_URL = getEnv('VERSION_DATA_URL');
  const NETWORK = getEnv('NETWORK', 'mainnet');

  log.info(`Connecting to node at ${new URL(PROVIDER_URL).origin}..`);
  const web3 = new Web3(PROVIDER_URL);
  await web3.eth.net.isListening();

  log.info('Initializing NexusContractLoader..');
  const nexusContractLoader = new NexusContractLoader(NETWORK, VERSION_DATA_URL, web3.eth.currentProvider);
  await nexusContractLoader.init();

  log.info('Initializing cover amount tracker..');
  const coverAmountTracker = new CoverAmountTracker(nexusContractLoader, web3);
  await coverAmountTracker.initialize();

  const quotationData = nexusContractLoader.instance('QD');

  const allProducts = await fetch(CONTRACTS_URL).then(r => r.json());
  const products = Object.keys(allProducts)
    .map(productId => ({ ...allProducts[productId], productId }))
    .filter(product => !product.deprecated);

  const batches = createBatches(products, 50);
  const deltas = [];

  const getActiveCoverAmount = async product => {
    const { productId, name } = product;

    for (const asset of ['ETH', 'DAI']) {
      const trackerAmount = await coverAmountTracker.getActiveCoverAmount(productId, asset);
      const onchainAmount = await quotationData.getTotalSumAssuredSC(productId, hex(asset));
      const delta = onchainAmount.sub(trackerAmount);

      if (delta.isZero()) {
        return;
      }

      deltas.push({ name, productId, asset, delta, trackerAmount, onchainAmount });
    }
  };

  for (const batch of batches) {
    await Promise.all(batch.map(async product => getActiveCoverAmount(product)));
  }

  const negativeDeltas = deltas.filter(delta => delta.delta.lt(0));
  const positiveDeltas = deltas.filter(delta => delta.delta.gt(0));

  const formatDelta = delta => [
    `${delta.name}`,
    `    onchain     : ${delta.onchainAmount.toString()} ${delta.asset}`,
    `    tracker     : ${delta.trackerAmount.toString()} ${delta.asset}`,
    `    tracker diff: ${delta.trackerAmount.gt(delta.onchainAmount) ? '+' : '-'}${delta.delta.toString()} ${delta.asset}`,
    '',
  ].join('\n');

  console.log('Negative deltas:\n', negativeDeltas.map(formatDelta).join('\n'));
  console.log('Positive deltas:\n', positiveDeltas.map(formatDelta).join('\n'));

  console.log(`Found negative differences in ${negativeDeltas.length} protocol/asset pairs`);
  console.log(`Found positive differences in ${positiveDeltas.length} protocol/asset pairs`);
}

if (require.main === module) {
  main()
    .then(() => process.exit(1))
    .catch(e => {
      console.log('Unhandled error encountered: ', e.stack);
      process.exit(1);
    });
}
