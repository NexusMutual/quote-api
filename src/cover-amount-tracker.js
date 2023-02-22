const BN = require('bn.js');
const log = require('./log');

const START_ID = '6820'; // oldest claimable cover id

const CURRENCIES_ADDRESSES = {
  ETH: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
  DAI: '0x6B175474E89094C44Da98b954EedeAC495271d0F',
};

const CoverStatus = {
  ClaimAccepted: 1,
};

const BATCH_SIZE = 1000;

const MINUTE_IN_MILLIS = 60 * 1000;

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

  async initialize () {
    this.lastVerifiedBlock = (await this.web3.eth.getBlock('latest')).number;
    this.lastCheckedCoverId = START_ID - 1;
    await this.fetchAllCovers();

    // timeouts are expressed in milliseconds
    setInterval(() => this.fetchAllCovers(), MINUTE_IN_MILLIS);
    setInterval(() => this.fetchPayoutEvents(), MINUTE_IN_MILLIS);
  }

  async fetchAllCovers (reset) {

    if (reset) {
      // start with a clean slate
      log.info(`Clearing existing cover data.`);
      this.lastCheckedCoverId = START_ID - 1;
      this.coverData = [];
    }

    log.info(`Fetching all new covers starting at cover id: ${this.lastCheckedCoverId}`);
    const quotationData = this.nexusContractLoader.instance('QD');
    const lastCoverId = (await quotationData.getCoverLength()).toNumber() - 1;

    const activeCoverIds = [];
    for (let j = this.lastCheckedCoverId + 1; j <= lastCoverId; j++) {
      activeCoverIds.push(j);
    }

    log.info(`Fetching ${activeCoverIds.length} covers.`);

    for (const batch of createBatches(activeCoverIds, BATCH_SIZE)) {
      log.info(`Fetching batch of covers with ids ${batch[0]} - ${batch[batch.length - 1]}`);
      const coversInBatch = await Promise.all(batch.map(async id => {
        const coverData = await this.fetchCover(id);
        return coverData;
      }));
      this.coverData.push(...coversInBatch);
    }
    this.lastCheckedCoverId = lastCoverId;
  }

  async fetchCover (id) {
    const gateway = this.nexusContractLoader.instance('GW');
    const tokenController = this.nexusContractLoader.instance('TC');
    const coverData = await gateway.getCover(id);
    const coverInfo = await tokenController.coverInfo(id);
    return { ...coverData, ...coverInfo };
  }

  async fetchPayoutEvents () {

    log.info(`Fetching payout events starting at block: ${this.lastVerifiedBlock}`);
    const pool = this.nexusContractLoader.instance('P1');
    const payoutEvents = await pool.getPastEvents('Payout', { fromBlock: this.lastVerifiedBlock });

    if (payoutEvents.length > 0) {
      // in case of a single payout event we refetch all cover data (rare event)
      // the Payout event does not have enough info to refresh only 1 particular cover

      log.info(`Payout events detected: ${payoutEvents.length}`);
      await this.fetchAllCovers(true);
    }

    this.lastVerifiedBlock = (await this.web3.eth.getBlock('latest')).number;
    log.info(`Last verified block is now: ${this.lastVerifiedBlock}`);
  }

  getActiveCoverAmount (contract, currency) {

    const currencyAddress = CURRENCIES_ADDRESSES[currency];

    // now is expressed in seconds to be compared to cover.validUntil
    const now = new Date().getTime() / 1000;

    const contractCovers = this.coverData.filter(
      c => {
        return c.contractAddress === contract &&
                c.coverAsset === currencyAddress &&
                c.validUntil.toNumber() > now;
      },
    );
    return this.computeActiveCoverAmount(contractCovers);
  }

  computeActiveCoverAmount (covers) {
    let activeCoverSum = new BN(0);

    // TODO: remove console.log
    console.log(`Computing based on ${covers.length} covers`);
    for (const cover of covers) {
      if (cover.status.toNumber() !== CoverStatus.ClaimAccepted) {
        // not claimed successfully and not expired
        // partial claims are counted as full claims for the purpose of the total sum assured computation
        // Partial claims can only be done once - cover is invalid after.
        activeCoverSum = activeCoverSum.add(cover.sumAssured);
      }
    }
    return activeCoverSum;
  }

}

module.exports = CoverAmountTracker;
