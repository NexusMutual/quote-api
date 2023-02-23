require('dotenv').config();

const fetch = require('node-fetch');
const Web3 = require('web3');
const BN = require('bn.js');
const Decimal = require('decimal.js');

const log = require('../src/log');
const CoverAmountTracker = require('../src/cover-amount-tracker');
const NexusContractLoader = require('../src/nexus-contract-loader');
const { getEnv } = require('../src/utils');

const CONTRACTS_URL = 'https://api.nexusmutual.io/coverables/contracts.json';
const NEXUS_TRACKER_COVERS = 'https://nexustracker.io/all_covers';

const hex = string => '0x' + Buffer.from(string).toString('hex');
const toBN = Web3.utils.toBN;
const WeiPerEther = Web3.utils.toWei(toBN(1), 'ether');

function createBatches (items, batchSize) {
  const batches = [];
  const copy = [...items];
  while (copy.length > 0) {
    batches.push(copy.splice(0, batchSize));
  }
  return batches;
}

async function fetchAllActiveCovers ({ gateway, tokenController }) {
  const now = new Date().getTime();
  const coverData = [];

  const covers = await fetch(NEXUS_TRACKER_COVERS, { headers: { 'Content-Type': 'application/json' } }).then(x => x.json());
  const active = covers.filter(c => new Date(c.end_time).getTime() > now);
  console.log({ activeCount: active.length });

  const batches = createBatches(active.map(c => c.cover_id), 50);

  for (const batch of batches) {
    const coversInBatch = await Promise.all(batch.map(async id => {
      const coverData = await gateway.getCover(id);
      const coverInfo = await tokenController.coverInfo(id);
      return { ...coverData, ...coverInfo };
    }));
    coverData.push(...coversInBatch);
  }

  return coverData;
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

  // !!!! IMPORTANT: uncomment this so all covers that expired since we eliminated on-chain substraction
  // are counted out.

  // modify covers that expired after upgrade to not expire
  // coverAmountTracker.coverData.forEach(data => {
  //
  //   const now = new Date().getTime() / 1000;
  //   const deployDate = new Date("2023-02-12 20:17:23").getTime() / 1000;
  //   const validUntil = new Date(data.validUntil.toNumber()).getTime();
  //
  //   if (validUntil > deployDate && validUntil < now) {
  //     data.validUntil = data.validUntil.addn(24 * 30 * 3600); // artificially add 1 month
  //   }
  // });

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
      const onchainAmount = (await quotationData.getTotalSumAssuredSC(productId, hex(asset))).mul(WeiPerEther);
      const delta = onchainAmount.sub(trackerAmount);

      if (delta.isZero()) {
        return;
      }

      deltas.push({
        name,
        productId,
        asset,
        trackerAmount: new Decimal(trackerAmount.toString()).div(1e18),
        onchainAmount: new Decimal(onchainAmount.toString()).div(1e18),
        delta: new Decimal(delta.toString()).div(1e18),
      });
    }
  };

  for (const batch of batches) {
    await Promise.all(batch.map(async product => getActiveCoverAmount(product)));
  }

  const negativeDeltas = deltas.filter(delta => delta.delta.lt(0));
  const positiveDeltas = deltas.filter(delta => delta.delta.gt(0));

  const formatDelta = delta => [
    `${delta.name}`,
    `    onchain     : ${delta.onchainAmount.toFixed(0)} ${delta.asset}`,
    `    tracker     : ${delta.trackerAmount.toFixed(0)} ${delta.asset}`,
    `    tracker diff: ${delta.trackerAmount.gt(delta.onchainAmount) ? '+' : '-'}${delta.delta.toFixed(0)} ${delta.asset}`,
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
