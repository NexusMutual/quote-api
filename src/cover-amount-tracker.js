const fetch = require("node-fetch");
const BN = require('bn.js');

const START_ID = '6820'; // oldest claimable cover id

const CURRENCIES_ADDRESSES = {
    ETH: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
    DAI: '0x6B175474E89094C44Da98b954EedeAC495271d0F'
};

const CoverStatus = {
    ClaimAccepted: 1
}

const BATCH_SIZE = 1000;

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

class CoverAmountTracker {

    constructor (nexusContractLoader, web3) {
        this.nexusContractLoader = nexusContractLoader;
        this.web3 = web3;
        this.coverData = [];
    }

    async initialize() {
        this.lastCoverBlock = (await this.web3.eth.getBlock('latest')).number;
        this.lastCheckedCoverId = START_ID - 1;
        this.lastClaimPayoutBlockNumber = 0;
        const lastCoverBlock = 0;
        await this.fetchAllCovers();
        //
        // setInterval(() => this.fetchNewCovers(), 300);
        //
        // setInterval(() => this.fetchPayoutEvents(), 300);
    }

    async fetchAllCovers () {

        console.log(`Fetching all new covers starting at cover id: ${this.lastCheckedCoverId}`);
        const quotationData = this.nexusContractLoader.instance('QD');
        const lastCoverId = (await quotationData.getCoverLength()).toNumber() - 1;

        const activeCoverIds = [];
        for (let j = this.lastCheckedCoverId; j <= lastCoverId; j++) {
            activeCoverIds.push(j);
        }

        console.log(`Fetching ${activeCoverIds.length} covers.`);

        const coverData = [];
        for (const batch of createBatches(activeCoverIds, BATCH_SIZE)) {
            console.log(`Fetching batch of covers with ids ${batch[0]} - ${batch[batch.length - 1]}`);
            const coversInBatch = await Promise.all(batch.map(async id => {
                const coverData = await this.fetchCover(id);
                return coverData;
            }));
            this.coverData.push(...coversInBatch);
        }
        this.lastCheckedCoverId = lastCoverId;
        // this.coverData.push(...coverData);
    }

    async fetchCover (id) {
        const gateway = this.nexusContractLoader.instance('GW');
        const tokenController = this.nexusContractLoader.instance('TC');
        const coverData = await gateway.getCover(id);
        const coverInfo = await tokenController.coverInfo(id);
        // return { id, contract, currency, amount, expiration, claimed, processed }
        return { ...coverData, ...coverInfo };
    }

    // async fetchNewCovers () {
    //     const coverDetailsEvents = await this.quotationData.getPastEvents('CoverDetailsEvent', { fromBlock: lastCoverBlock });
    //     for (const event of coverDetailsEvents) {
    //         const newCoverData = await this.fetchCover(event.cid);
    //         this.coverData.push(newCoverData);
    //     }
    //     this.lastCoverBlock = (await this.web3.eth.getBlock('latest')).number;
    // }

    getActiveCoverAmount (contract, currency) {

        const currencyAddress = CURRENCIES_ADDRESSES[currency];

        const now = new Date().getTime() / 1000;

        const contractCovers = this.coverData.filter(
            c => {
                return c.contractAddress === contract
                && c.coverAsset === currencyAddress
                && c.validUntil.toNumber() > now;
            }
        );
        return this.computeActiveCoverAmount(contractCovers);
    }

    computeActiveCoverAmount(covers) {
        let activeCoverSum = new BN(0);

        console.log(`Computing based on ${covers.length} covers`);
        for (const cover of covers) {
            if (cover.status.toNumber() === CoverStatus.ClaimAccepted && cover.requestedPayoutAmount.gtn(0)) {
                activeCoverSum = activeCoverSum.add(cover.sumAssured).sub(cover.requestedPayoutAmount);
            } else {
                // not claimed and not expired
                activeCoverSum = activeCoverSum.add(cover.sumAssured);
            }
        }
        return activeCoverSum;
    }

};

module.exports = CoverAmountTracker;
