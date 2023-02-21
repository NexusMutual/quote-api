


const START_ID = 'x'; // oldest claimable cover id

const coverAmountTracker = (nexusContractLoader, web3) => {
    // data store
    // mapping contract address => { eth: m, dai: n }
    const amounts = {};
    // array of { id, contract, currency: ETH|DAI, amount: n, expiration: d, claimed: true|false, processed: true|false }
    const covers = {};

    const lastCoverId = START_ID - 1;
    const lastClaimPayoutBlockNumber = 0;

    const fetchCover = async id => {
        // query QD & TC
        // construct object:
        // return { id, contract, currency, amount, expiration, claimed, processed }
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

    // initialization:
    await fetchNewCovers();
    setInterval(300, fetchNewCovers);

    await fetchPayoutEvents();
    setInterval(300, fetchPayoutEvents);

    setInterval(60, expireCovers);

    const api = {
        get: (contract, currency) => amounts[contract][currency],
    };

    return api;
};

module.exports = coverAmountTracker;
