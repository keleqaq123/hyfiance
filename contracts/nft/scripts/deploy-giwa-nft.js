const fs = require('node:fs');
const path = require('node:path');
const { ethers, network } = require('hardhat');

const ROOT = path.resolve(__dirname, '..');
const DEPLOYMENTS = path.join(ROOT, 'deployments');
const DEPLOYMENT_FILE = path.join(DEPLOYMENTS, 'giwa-sepolia.json');
const FRONTEND_FILE = path.resolve(ROOT, '../../apps/web/src/custos/nftDeployment.json');
const CHAIN_ID = 91342;
const RPC = process.env.GIWA_RPC_URL || 'https://sepolia-rpc.giwa.io';
const EXPLORER = process.env.GIWA_EXPLORER || 'https://sepolia-explorer.giwa.io';
const BASE_URI = process.env.NFT_BASE_URI || 'https://www.custosfinance.xyz/nft/metadata/';
const MINT_PRICE_ETH = process.env.NFT_MINT_PRICE_ETH || '0.0001';

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function historyStamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

async function main() {
  const chain = await ethers.provider.getNetwork();
  if (Number(chain.chainId) !== CHAIN_ID || Number(network.config.chainId) !== CHAIN_ID) {
    throw new Error(`Expected GIWA Sepolia (${CHAIN_ID}), got ${chain.chainId}`);
  }

  const [deployer] = await ethers.getSigners();
  if (!deployer) throw new Error('No deployer account configured. Set PRIVATE_KEY in the deployment environment.');

  const mintPriceWei = ethers.parseEther(MINT_PRICE_ETH);
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`Deploying GIWA Genesis from ${deployer.address}`);
  console.log(`Deployer balance: ${ethers.formatEther(balance)} ETH`);
  console.log(`Mint price: ${MINT_PRICE_ETH} ETH`);

  const factory = await ethers.getContractFactory('GiwaGenesis', deployer);
  const contract = await factory.deploy(mintPriceWei, BASE_URI);
  const deploymentTx = contract.deploymentTransaction();
  if (!deploymentTx) throw new Error('Deployment transaction was not created.');
  const receipt = await deploymentTx.wait();
  const contractAddress = await contract.getAddress();
  const deployedAt = new Date().toISOString();
  const record = {
    network: 'GIWA Sepolia',
    chainId: CHAIN_ID,
    rpc: RPC,
    explorer: EXPLORER,
    deployedAt,
    deployer: deployer.address,
    contractAddress,
    deploymentTx: deploymentTx.hash,
    blockNumber: receipt ? receipt.blockNumber : null,
    constructor: {
      mintPriceWei: mintPriceWei.toString(),
      mintPriceEth: MINT_PRICE_ETH,
      baseURI: BASE_URI,
    },
    collection: {
      name: await contract.name(),
      symbol: await contract.symbol(),
      maxSupply: (await contract.MAX_SUPPLY()).toString(),
      walletLimit: (await contract.WALLET_LIMIT()).toString(),
      mintOpen: await contract.mintOpen(),
    },
    smoke: null,
  };

  writeJson(DEPLOYMENT_FILE, record);
  writeJson(path.join(DEPLOYMENTS, 'history', `${historyStamp()}--giwa-sepolia.json`), record);
  writeJson(FRONTEND_FILE, {
    network: record.network,
    chainId: record.chainId,
    rpc: record.rpc,
    explorer: record.explorer,
    deployedAt: record.deployedAt,
    deployer: record.deployer,
    contractAddress: record.contractAddress,
    deploymentTx: record.deploymentTx,
    baseURI: record.constructor.baseURI,
    artworkPath: '/assets/nft/collection-artwork.png',
    collectionName: record.collection.name,
    symbol: record.collection.symbol,
    totalSupply: Number(record.collection.maxSupply),
    walletLimit: Number(record.collection.walletLimit),
    mintPrice: record.constructor.mintPriceEth,
    paymentSymbol: 'ETH',
  });

  console.log(JSON.stringify({
    ok: true,
    network: record.network,
    chainId: record.chainId,
    contractAddress: record.contractAddress,
    deploymentTx: record.deploymentTx,
    blockNumber: record.blockNumber,
    mintPrice: record.constructor.mintPriceEth,
    baseURI: record.constructor.baseURI,
    record: path.relative(process.cwd(), DEPLOYMENT_FILE),
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
