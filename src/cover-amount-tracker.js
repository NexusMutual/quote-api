const fetch = require("node-fetch");

const START_ID = 'x'; // oldest claimable cover id

class coverAmountTracker {


    constructor (nexusContractLoader, web3) {
        this.nexusContractLoader = nexusContractLoader;
        this.web3 = web3;
        this.coverData = {};
    }

    async initialize() {
        this.coverData = this.fetchAllActiveCovers();
    }

    async fetchAllActiveCovers () {
        const url = 'https://nexustracker.io/all_covers';
        const covers = await fetch(url, { headers: { 'Content-Type': 'application/json' } }).then(x => x.json());
        console.log({
            covers
        });
        const now = new Date().getTime();
        const active = covers.filter(c => new Date(c.end_time).getTime() > now);
        console.log({
            activeCount: active.length
        })
        const activeCoverIds = active.map(c => c.cover_id);

        const coverData = [];
        for (const batch of createBatches(activeCoverIds, 50)) {
            const coversInBatch = await Promise.all(batch.map(async id => {
                const coverData = await this.fetchCover(id);
                return coverData;
            }));
            coverData.push(coversInBatch);
        }
        return coverData;
    }

    // data store
    // mapping contract address => { eth: m, dai: n }
    const amounts = {};
    // array of { id, contract, currency: ETH|DAI, amount: n, expiration: d, claimed: true|false, processed: true|false }
    const covers = {};

    const lastCoverId = START_ID - 1;
    const lastClaimPayoutBlockNumber = 0;

    const lastCoverBlock = 0;

    async fetchCover (id) {
        const gateway = this.nexusContractLoader.instance('GW');
        const tokenController = this.nexusContractLoader.instance('TC');
        const coverData = await gateway.getCover(id);
        const coverInfo = await tokenController.coverInfo(id);
        // return { id, contract, currency, amount, expiration, claimed, processed }
        return { ...coverData, ...coverInfo };
    }

    const fetchNewCovers = async () => {
        // get last cover id in prod
        // if last cover id in prod > lastCoverId
        // for i = lastCoverId + 1; i <= lastCoverIdInProd
        //   - fetchCover(id)
        //   - if cover is past expiration date set processed = true
        //   - if cover has accepted claim skip set processed = true
        //   - if not processed: amounts[contract][currency] += amount
        //   - add to covers object
        //   - lastCoverId = i

        const coverDetailsEvents = await this.quotationData.getPastEvents('CoverDetailsEvent', { fromBlock: lastCoverBlock });
    }

    const fetchPayoutEvents = async lastBlock => {
        const fromBlock = lastClaimPayoutBlockNumber + 1;
        // get events in batches of 1000 blocks
        // for each payout
        //   - get claim id
        //   - get cover id
        //   - set covers[coverId].claimed = true
        //   - if not covers[coverId].processed
        //      - reduce total cover amount
        //      - set covers[coverId].processed = true
        // lastClaimPayoutBlockNumber = lastBlockNumber
    }

    const expireCovers = () => {
        // for loop through all Object.keys(covers)
        // if expiration date is in the past and not processed:
        //   - amounts[contract][currency] -= amount
        //   - set covers[coverId].processed = true
    }

    // // initialization:
    // await fetchNewCovers();
    // setInterval(300, fetchNewCovers);
    //
    // await fetchPayoutEvents();
    // setInterval(300, fetchPayoutEvents);
    //
    // setInterval(60, expireCovers);

    getActiveCoverAmount(contract, currency) {

    }

};

module.exports = coverAmountTracker;
