const fs = require('node:fs');
const path = require('node:path');
const { ethers, network } = require('hardhat');

const ROOT = path.resolve(__dirname, '..');
const DEPLOYMENT_FILE = path.join(ROOT, 'deployments', 'giwa-sepolia.json');
const DEPLOYMENTS = path.join(ROOT, 'deployments');
const CHAIN_ID = 91342;

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function historyStamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function readEventually(reader, label, predicate, attempts = 30) {
  let lastValue;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      lastValue = await reader();
      if (predicate(lastValue)) return lastValue;
    } catch {
      // Public GIWA RPCs can briefly lag the block included by wait().
    }
    await sleep(1000);
  }
  throw new Error(`${label} was not visible on the read RPC after ${attempts} attempts (last value: ${lastValue})`);
}

async function main() {
  const chain = await ethers.provider.getNetwork();
  if (Number(chain.chainId) !== CHAIN_ID || Number(network.config.chainId) !== CHAIN_ID) {
    throw new Error(`Expected GIWA Sepolia (${CHAIN_ID}), got ${chain.chainId}`);
  }
  if (!fs.existsSync(DEPLOYMENT_FILE)) throw new Error(`Missing ${DEPLOYMENT_FILE}; deploy first.`);

  const record = readJson(DEPLOYMENT_FILE);
  const [signer] = await ethers.getSigners();
  const contract = await ethers.getContractAt('GiwaGenesis', record.contractAddress, signer);
  const price = await contract.mintPrice();
  const beforeSupply = await contract.totalSupply();
  const beforeWalletMints = await contract.mintedByWallet(signer.address);
  let mintTx = record.smoke && record.smoke.mintTx ? record.smoke.mintTx : null;
  let tokenId = record.smoke && record.smoke.tokenId ? BigInt(record.smoke.tokenId) : null;

  assert((await contract.name()) === 'GIWA Genesis', 'collection name mismatch');
  assert((await contract.symbol()) === 'GIWA', 'collection symbol mismatch');
  assert((await contract.MAX_SUPPLY()) === 1111n, 'max supply mismatch');
  assert((await contract.WALLET_LIMIT()) === 1n, 'wallet limit mismatch');
  assert(await contract.mintOpen(), 'mint should be open');
  assert((await contract.baseURI()) === record.constructor.baseURI, 'base URI mismatch');

  if (beforeWalletMints === 0n) {
    const transaction = await contract.publicMint(1, { value: price });
    const receipt = await transaction.wait();
    mintTx = transaction.hash;
    const afterSupply = await readEventually(
      () => contract.totalSupply(),
      'totalSupply after mint',
      (value) => value === beforeSupply + 1n,
    );
    tokenId = afterSupply;
    assert(receipt && receipt.status === 1, 'mint transaction did not succeed');
  } else {
    assert(beforeWalletMints === 1n, 'wallet minted more than the configured limit');
    if (tokenId === null) {
      tokenId = await readEventually(
        () => contract.totalSupply(),
        'existing minted token id',
        (value) => value > 0n,
      );
    }
  }

  assert(tokenId !== null, 'token id was not recorded');
  const mintedByWallet = await readEventually(
    () => contract.mintedByWallet(signer.address),
    'wallet mint count',
    (value) => value === 1n,
  );
  const ownerOf = await readEventually(
    () => contract.ownerOf(tokenId),
    'token owner',
    (value) => value.toLowerCase() === signer.address.toLowerCase(),
  );
  const tokenUri = await readEventually(
    () => contract.tokenURI(tokenId),
    'token URI',
    (value) => value === `${record.constructor.baseURI}${tokenId.toString()}`,
  );
  assert(tokenUri === `${record.constructor.baseURI}${tokenId.toString()}`, 'tokenURI mismatch');

  if (!mintTx) {
    const mintLogs = await ethers.provider.getLogs({
      address: record.contractAddress,
      topics: [ethers.id('Minted(address,uint256)')],
      fromBlock: record.blockNumber,
      toBlock: 'latest',
    });
    const matchingLog = mintLogs.find((log) => BigInt(log.topics[2]) === tokenId);
    mintTx = matchingLog ? matchingLog.transactionHash : null;
  }

  let duplicateRejected = false;
  try {
    await contract.publicMint.staticCall(1, { value: price });
  } catch {
    duplicateRejected = true;
  }
  assert(duplicateRejected, 'duplicate mint was not rejected');

  const smoke = {
    ok: true,
    checkedAt: new Date().toISOString(),
    signer: signer.address,
    mintTx,
    tokenId: tokenId.toString(),
    totalSupply: (await contract.totalSupply()).toString(),
    mintedByWallet: mintedByWallet.toString(),
    ownerOf,
    tokenURI: tokenUri,
    duplicateMintRejected: duplicateRejected,
  };
  record.smoke = smoke;
  writeJson(DEPLOYMENT_FILE, record);
  writeJson(path.join(DEPLOYMENTS, 'history', `${historyStamp()}--smoke.json`), {
    deployment: record.contractAddress,
    network: record.network,
    chainId: record.chainId,
    smoke,
  });

  console.log(JSON.stringify(smoke, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
