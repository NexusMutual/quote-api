const Web3 = require('web3');
const log = require('./log');

const CURRENCIES_ADDRESSES = {
  ETH: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
  DAI: '0x6B175474E89094C44Da98b954EedeAC495271d0F',
};

const START_ID = 1;
const CLAIM_ACCEPTED = 1;
const BATCH_SIZE = 300;
const MINUTE_IN_MILLIS = 60 * 1000;

const toBN = Web3.utils.toBN;
const WeiPerEther = Web3.utils.toWei(toBN(1), 'ether');
const Zero = toBN(0);

class CoverAmountTracker {

  constructor (nexusContractLoader, web3) {
    this.nexusContractLoader = nexusContractLoader;
    this.web3 = web3;
    this.coverData = [];
  }

  async initialize () {
    this.lastVerifiedBlock = (await this.web3.eth.getBlock('latest')).number;
    await this.fetchAllCovers();

    // timeouts are expressed in milliseconds
    setInterval(() => this.fetchNewCovers(), MINUTE_IN_MILLIS);
    setInterval(() => this.fetchPayoutEvents(), MINUTE_IN_MILLIS);
  }

  async fetchCovers (from, to) {
    const batches = [];
    const coverIds = [];
    const covers = [];

    for (let id = from; id <= to; id++) {
      coverIds.push(id);
    }

    while (coverIds.length > 0) {
      batches.push(coverIds.splice(0, BATCH_SIZE));
    }

    log.info(`Fetching ${to - from + 1} covers in ${batches.length} batches.`);

    for (const batch of batches) {
      log.info(`Fetching batch of covers with ids ${batch[0]} - ${batch[batch.length - 1]}`);
      const coversInBatch = await Promise.all(batch.map(async id => this.fetchCover(id)));
      covers.push(...coversInBatch);
    }

    return covers;
  }

  async fetchAllCovers () {
    log.info(`Fetching all covers`);
    const quotationData = this.nexusContractLoader.instance('QD');
    const lastCoverId = (await quotationData.getCoverLength()).toNumber() - 1;
    this.coverData = await this.fetchCovers(START_ID, lastCoverId);
    this.lastCoverId = lastCoverId;
  }

  async fetchNewCovers () {
    log.info(`Fetching new covers`);
    const quotationData = this.nexusContractLoader.instance('QD');
    const lastCoverId = (await quotationData.getCoverLength()).toNumber() - 1;
    const newCovers = await this.fetchCovers(this.lastCoverId + 1, lastCoverId);
    this.coverData.push(...newCovers);
    this.lastCoverId = lastCoverId;
  }

  async fetchCover (id) {
    const gateway = this.nexusContractLoader.instance('GW');
    const tokenController = this.nexusContractLoader.instance('TC');
    const { sumAssured, ...otherData } = await gateway.getCover(id);
    const coverInfo = await tokenController.coverInfo(id);
    return { sumAssured: sumAssured.div(WeiPerEther), ...otherData, ...coverInfo };
  }

  async fetchPayoutEvents () {
    const fromBlock = this.lastVerifiedBlock + 1;
    const toBlock = (await this.web3.eth.getBlock('latest')).number;
    log.info(`Fetching payout events starting from block ${fromBlock} to block ${toBlock}`);

    const pool = this.nexusContractLoader.instance('P1');
    const payoutEvents = await pool.getPastEvents('Payout', { fromBlock, toBlock });

    if (payoutEvents.length > 0) {
      // in case of a single payout event we refetch all cover data (rare event)
      // the Payout event does not have enough info to refresh only 1 particular cover
      log.info(`Payout events detected: ${payoutEvents.length}`);
      await this.fetchAllCovers();
    }

    this.lastVerifiedBlock = toBlock;
    log.info(`Last verified block is now: ${toBlock}`);
  }

  getActiveCoverAmount (contract, currency) {
    const now = new Date().getTime() / 1000;
    // const deployDate = new Date('2023-02-13T21:45:00Z').getTime() / 1000;

    const coverAmount = this.coverData
      .filter(c => c.contractAddress.toLowerCase() === contract.toLowerCase())
      .filter(c => c.coverAsset === CURRENCIES_ADDRESSES[currency])
      .filter(c => c.validUntil.toNumber() > now)
      // .filter(c => c.validUntil.toNumber() > deployDate)
      .filter(c => c.status.toNumber() !== CLAIM_ACCEPTED)
      .reduce((acc, c) => acc.add(c.sumAssured), Zero);

    return coverAmount;
  }
}

module.exports = CoverAmountTracker;
