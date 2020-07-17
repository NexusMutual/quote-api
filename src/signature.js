const ethABI = require('ethereumjs-abi');
const util = require('ethereumjs-util');
const wallet = require('eth-lightwallet').keystore;

function signQuote (quotationData, quotationContractAddress) {
  console.log('In function: getVRS');

  const currency = '0x' + Buffer.from(quotationData.coverCurr, 'utf8').toString('hex');
  const orderParts = [
    { value: bigNumberToBN(quotationData.coverAmount), type: 'uint' },
    { value: currency, type: 'bytes4' },
    { value: bigNumberToBN(quotationData.coverPeriod), type: 'uint16' },
    { value: quotationData.smartCA, type: 'address' },
    { value: bigNumberToBN(quotationData.coverCurrPrice.toFixed()), type: 'uint' },
    { value: bigNumberToBN(quotationData.PriceNxm.toFixed()), type: 'uint' },
    { value: bigNumberToBN(quotationData.expireTime), type: 'uint' },
    { value: bigNumberToBN(quotationData.generationTime), type: 'uint' },
    { value: quotationContractAddress, type: 'address' },
  ];

  const types = orderParts.map(o => o.type);
  const values = orderParts.map(o => o.value);
  const hashBuff = ethABI.soliditySHA3(types, values);
  const hashHex = util.bufferToHex(hashBuff);

  console.log('hashHex---->' + hashHex);

  let resultKs = getKeystore();
  if (resultKs != null) {
    resultKs = JSON.parse(resultKs);

    ks = (resultKs[0].instance);
    // ks = JSON.stringify(ks);
    ks = wallet.deserialize(ks);
    // Some methods will require providing the `pwDerivedKey`,
    // Allowing you to only decrypt private keys on an as-needed basis.
    // You can generate that value with this convenient method:
    ks.keyFromPassword(METAMASK_PASSWORD, function (err, pwDerivedKey) {
      if (err) throw err;

      // generate five new address/private key pairs
      // the corresponding private keys are also encrypted
      ks.generateNewAddress(pwDerivedKey, 1);
      console.log('privatekey---->', ks, ' ', pwDerivedKey.toString('hex'));
      var addr = ks.getAddresses();
      ks.passwordProvider = function (callback) {
        var pw = prompt('Please enter password', 'Password');
        callback(null, pw);

      };

      const orderHashBuff = util.toBuffer(hashHex);
      const msgHashBuff = util.hashPersonalMessage(orderHashBuff);
      const sig = lightwallet.signing.signMsgHash(ks, pwDerivedKey, msgHashBuff, ks.getAddresses()[0]);

      console.log(sig.v, ' ', util.toUnsigned(util.fromSigned(sig.r)).toString('hex'), '  ', util.toUnsigned(util.fromSigned(sig.s)).toString('hex'));

      const prefixedMsg = util.sha3(Buffer.concat([
        Buffer.from('\x19Ethereum Signed Message:\n', 'utf8'),
        // util.toBuffer(String(32)),
        Buffer.from('32', 'utf8'),
        orderHashBuff,
      ]));

      quotationData.v = sig.v;
      quotationData.r = '0x' + util.toUnsigned(util.fromSigned(sig.r)).toString('hex');
      quotationData.s = '0x' + util.toUnsigned(util.fromSigned(sig.s)).toString('hex');
      console.log('QD', quotationData);
      res.end(JSON.stringify(quotationData));

      const pubKey = util.ecrecover(prefixedMsg, sig.v, sig.r, sig.s);
      const addrBuf = util.pubToAddress(pubKey);
      const addr1 = util.bufferToHex(addrBuf);

      console.log(ks.getAddresses()[0], addr1);
    });
  }
}


module.exports = {
  sign: signQuote
}
