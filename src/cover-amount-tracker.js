const fetch = require("node-fetch");
const BN = require('bn.js');

const START_ID = 'x'; // oldest claimable cover id

const CURRENCIES_ADDRESSES = {
    ETH: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
    DAI: '0x6B175474E89094C44Da98b954EedeAC495271d0F'
};

class coverAmountTracker {



    constructor (nexusContractLoader, web3) {
        this.nexusContractLoader = nexusContractLoader;
        this.web3 = web3;
        this.coverData = {};
    }

    async initialize() {
        this.lastCoverBlock = (await this.web3.eth.getBlock('latest')).number;
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

    async fetchNewCovers {
        const coverDetailsEvents = await this.quotationData.getPastEvents('CoverDetailsEvent', { fromBlock: lastCoverBlock });
        for (const event of coverDetailsEvents) {
            const newCoverData = await this.fetchCover(event.cid);
            this.coverData.push(newCoverData);
        }
        this.lastCoverBlock = (await this.web3.eth.getBlock('latest')).number;
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

    // // initialization:
    // await fetchNewCovers();
    // setInterval(300, fetchNewCovers);
    //
    // await fetchPayoutEvents();
    // setInterval(300, fetchPayoutEvents);
    //
    // setInterval(60, expireCovers);

    getActiveCoverAmount (contract, currency) {

        const currencyAddress = CURRENCIES_ADDRESSES;
        const contractCovers = this.coverData.filter(
            c => c.contractAddress === contract && c.coverAsset === currencyAddress
        );
        contractCovers
    }

    computeActiveCoverAmount(covers) {
        let activeCoverSum = new BN(0);

        for (const cover of covers) {

        }
    }

};

module.exports = coverAmountTracker;
