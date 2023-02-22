const fetch = require('node-fetch');
const log = require("../src/log");
const Web3 = require("web3");
const NexusContractLoader = require("../src/nexus-contract-loader");
const {getEnv} = require("../src/utils");
const BN = require('bn.js');
const Decimal = require('decimal.js');

const CoverAmountTracker = require('../src/cover-amount-tracker');
const CONTRACTS_URL = 'https://api.nexusmutual.io/coverables/contracts.json';
const hex = string => '0x' + Buffer.from(string).toString('hex');

function createBatches (a, batchSize) {
    const batches = [];
    let currentBatch = [];
    for (let i = 0; i < a.length; i++) {
        if (currentBatch.length === batchSize) {
            batches.push(currentBatch);
            currentBatch = [a[i]];
        } else {
            currentBatch.push(a[i]);
        }
    }
    if (currentBatch.length > 0) {
        batches.push(currentBatch);
    }
    return batches;
}


async function fetchAllActiveCovers ({ gateway, tokenController }) {
    const url = 'https://nexustracker.io/all_covers';
    const covers = await fetch(url, { headers: { 'Content-Type': 'application/json' } }).then(x => x.json());


    const now = new Date().getTime();
    let j = 0;
    for (let i = 0; i < covers.length; i++) {
        const cover = covers[i];

        if (new Date(cover.end_time).getTime() > now) {
            j++;
        }

        if (j > 4) {
            break;
        }
    }

    const active = covers.filter(c => new Date(c.end_time).getTime() > now);
    console.log({
        activeCount: active.length
    })
    const activeCoverIds = active.map(c => c.cover_id);

    const coverData = [];
    for (const batch of createBatches(activeCoverIds, 50)) {
        const coversInBatch = await Promise.all(batch.map(async id => {
            const coverData = await gateway.getCover(id);
            const coverInfo = await tokenController.coverInfo(id);
            return { ...coverData, ...coverInfo };
        }));
        coverData.push(coversInBatch);
    }
    return coverData;
}


async function main() {
    require('dotenv').config();

    const PROVIDER_URL = getEnv('PROVIDER_URL');
    const VERSION_DATA_URL = getEnv('VERSION_DATA_URL');
    const PRIVATE_KEY = getEnv('PRIVATE_KEY');
    const NETWORK = getEnv('NETWORK', 'mainnet');
    const MONGO_URL = getEnv('MONGO_URL', 'mainnet');
    const CAPACITY_FACTOR_END_DATE = getEnv('CAPACITY_FACTOR_END_DATE', 'mainnet');
    const QUOTE_SIGN_MIN_INTERVAL_SECONDS = parseInt(getEnv('QUOTE_SIGN_MIN_INTERVAL_SECONDS'));

    log.info(JSON.stringify({
        VERSION_DATA_URL,
        NETWORK,
        CAPACITY_FACTOR_END_DATE,
        QUOTE_SIGN_MIN_INTERVAL_SECONDS,
    }));

    log.info(`Connecting to node at ${new URL(PROVIDER_URL).origin}..`);
    const web3 = new Web3(PROVIDER_URL);
    await web3.eth.net.isListening();
    

    log.info('Initializing NexusContractLoader..');
    const nexusContractLoader = new NexusContractLoader(NETWORK, VERSION_DATA_URL, web3.eth.currentProvider);
    await nexusContractLoader.init();


    const coverAmountTracker = new CoverAmountTracker(nexusContractLoader, web3);

    await coverAmountTracker.initialize();
    const active = await coverAmountTracker.getActiveCoverAmount(
        '0x1F98431c8aD98523631AE4a59f267346ea31F984',
        'ETH'
    );
    console.log({
        active: active.toString()
    })

    const quotationData = nexusContractLoader.instance('QD');

    const products = await fetch(CONTRACTS_URL).then(r => r.json());

    const significantDeltas = [];

    const batches = createBatches(Object.keys(products), 50);

    for (const batch of batches) {
        await Promise.all(batch.map(async productKey => {

            const product = products[productKey];
            if (product.deprecated) {
                return;
            }

            for (const asset of ['ETH', 'DAI']) {
                const trackerActiveCoverAmount = await coverAmountTracker.getActiveCoverAmount(
                    productKey,
                    asset
                );

                const onchainActiveCoverAmount = (await quotationData.getTotalSumAssuredSC(productKey, hex(asset)))
                    .mul(new BN(1e18.toString()));


                const activeCoverAmountDelta = trackerActiveCoverAmount.sub(onchainActiveCoverAmount).abs();

                const counts = {
                    trackerActiveCoverAmount: Decimal(trackerActiveCoverAmount.toString()).div(1e18),
                    onchainActiveCoverAmount: Decimal(onchainActiveCoverAmount.toString()).div(1e18),
                    activeCoverAmountDelta: Decimal(activeCoverAmountDelta.toString()).div(1e18)
                };
                // console.log(counts);

                if (activeCoverAmountDelta.gt(new BN(1e18.toString()))) {
                    significantDeltas.push({...counts, productName: product.name, productKey, asset });
                    // console.log(`Significant different for ${product.name} ${productKey}`);
                }
            }
        }));
    }
    console.log(significantDeltas);

    return;

    const allActiveCovers = await fetchAllActiveCovers({
            gateway: nexusContractLoader.instance('GW'),
            tokenController: nexusContractLoader.instance('TC')
    });

    console.log(allActiveCovers);
}


if (require.main === module) {
    main()
        .then(() => console.log('Done!'))
        .catch(e => {
            console.log('Unhandled error encountered: ', e.stack);
            process.exit(1);
        });
}

