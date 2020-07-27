
const QuoteStatus = {
  UNCOVERABLE: 'Uncoverable',
  MCR_EXCEEDED: 'MCRExceed',
  CAPACITY_LIMIT_EXCEEDED: 'capacityLimitExceed',
  OK: 'ok',
};

const CapacityLimit = {
  GLOBAL_LIMIT: 'GLOBAL_LIMIT',
  CONTRACT_LIMIT: 'CONTRACT_LIMIT',
};

function capacityLimitToQuoteStatus (limit) {
  switch (limit) {
    case CapacityLimit.GLOBAL_LIMIT:
      return QuoteStatus.MCR_EXCEEDED;
    case CapacityLimit.CONTRACT_LIMIT:
      return QuoteStatus.CAPACITY_LIMIT_EXCEEDED;
    default:
      throw new Error(`Unsupported CapacityLimit ${limit}`);
  }
}

module.exports = {
  QuoteStatus,
  CapacityLimit,
  capacityLimitToQuoteStatus,
};
