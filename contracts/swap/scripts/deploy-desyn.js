const { ethers, network } = require('hardhat');

// Variables
let tx;
let txReceipt;
const approvalAmount = '1000';
const wethMint = '1';
const deployed = {};

// Pool Configuration (tok0 is WETH)
const pool1 = {
   weight: {
      tok0: '10',
      tok1: '10',
      tok2: '10',
      tok3: '0',
   },
   bind: {
      tok0: '0.1',
      tok1: '200',
      tok2: '300',
      tok3: '0',
   },
};
const pool2 = {
   weight: {
      tok0: '10',
      tok1: '10',
      tok2: '10',
      tok3: '10',
   },
   bind: {
      tok0: '0.1',
      tok1: '200',
      tok2: '300',
      tok3: '400',
   },
};
const pool3 = {
   weight: {
      tok0: '20',
      tok1: '10',
      tok2: '0',
      tok3: '5',
   },
   bind: {
      tok0: '0.2',
      tok1: '200',
      tok2: '0',
      tok3: '200',
   },
};
const pool4 = {
   weight: {
      tok0: '0',
      tok1: '0',
      tok2: '10',
      tok3: '5',
   },
   bind: {
      tok0: '0',
      tok1: '0',
      tok2: '200',
      tok3: '100',
   },
};
const pools = { pool1, pool2, pool3, pool4 };

const swapFee = '0.05';

// Deploy function
async function deploy() {
   console.log(`----- DEPLOYMENTS -----`);
   [account1] = await ethers.getSigners();

   deployerAddress = account1.address;
   console.log(`Deploying core contracts using ${deployerAddress}`);

   //Deploy Factory
   const factory = await ethers.getContractFactory('Factory');
   const factoryInstance = await factory.deploy();
   await factoryInstance.deployed();
   console.log(`Deploy: Factory deployed to : ${factoryInstance.address}`);
   deployed['Factory'] = factoryInstance.address;

   //Deploy WETH
   const weth = await ethers.getContractFactory('WETH');
   let wethInstance
   if (network.name === 'local' || network.name === 'hardhat') {
      wethInstance = await weth.deploy();
      await wethInstance.deployed();
      wethAddress = wethInstance.address;
      console.log(`Deploy: WETH deployed to : ${wethAddress}`);
   } else {
      wethAddress = '0xd0A1E359811322d97991E03f863a0C30C2cF029C'; // kovan weth
      wethInstance = weth.attach(wethAddress);
   }
   deployed['WETH'] = wethAddress;

   //Deploy ExchangeProxy
   const proxy = await ethers.getContractFactory('ExchangeProxy');
   const proxyInstance = await proxy.deploy(wethAddress);
   await proxyInstance.deployed();
   console.log(`Deploy: Proxy deployed to : ${proxyInstance.address}`);
   deployed['ExchangeProxy'] = proxyInstance.address;

   //Deploy Multicall (needed for Interface)
   const multicall = await ethers.getContractFactory('Multicall');
   const multicallInstance = await multicall.deploy();
   await multicallInstance.deployed();
   console.log(`Deploy: Multicall deployed to : ${multicallInstance.address}`);
   deployed['Multicall'] = multicallInstance.address;

   //Deploy sorMultiCall
   const sorMC = await ethers.getContractFactory('sorMultiCall');
   const sorMCInstance = await sorMC.deploy();
   await sorMCInstance.deployed();
   console.log(`Deploy: sorMultiCall deployed to : ${sorMCInstance.address}`);
   deployed['sorMultiCall'] = sorMCInstance.address;

   if (network.name === 'local' || network.name === 'hardhat') {
      //Deploy New Pool - Get Address and Create Instance
      tx = await factoryInstance.newLiquidityPool();
      txReceipt = await tx.wait();
      const poolAddress1 = txReceipt.logs[1].address;
      console.log(`Deploy: LiquidityPool1 deployed to : ${poolAddress1}`);
      const pool1 = await ethers.getContractFactory('LiquidityPool');
      const poolInstance1 = pool1.attach(poolAddress1);
      deployed['LiquidityPool1'] = poolAddress1;

      tx = await factoryInstance.newLiquidityPool();
      txReceipt = await tx.wait();
      const poolAddress2 = txReceipt.logs[1].address;
      console.log(`Deploy: LiquidityPool2 deployed to : ${poolAddress2}`);
      const pool2 = await ethers.getContractFactory('LiquidityPool');
      const poolInstance2 = pool2.attach(poolAddress2);
      deployed['LiquidityPool2'] = poolAddress2;

      tx = await factoryInstance.newLiquidityPool();
      txReceipt = await tx.wait();
      const poolAddress3 = txReceipt.logs[1].address;
      console.log(`Deploy: LiquidityPool3 deployed to : ${poolAddress3}`);
      const pool3 = await ethers.getContractFactory('LiquidityPool');
      const poolInstance3 = pool3.attach(poolAddress3);
      deployed['LiquidityPool3'] = poolAddress3;

      tx = await factoryInstance.newLiquidityPool();
      txReceipt = await tx.wait();
      const poolAddress4 = txReceipt.logs[1].address;
      console.log(`Deploy: LiquidityPool4 deployed to : ${poolAddress4}`);
      const pool4 = await ethers.getContractFactory('LiquidityPool');
      const poolInstance4 = pool4.attach(poolAddress4);
      deployed['LiquidityPool4'] = poolAddress4;
      
      //Deploy Tokens
      const tok1 = await ethers.getContractFactory('Token');
      const tok1Instance = await tok1.deploy('Token1', 'TOK1');
      await tok1Instance.deployed();
      const tok1Address = tok1Instance.address;
      console.log(`Deploy: Token1 deployed to : ${tok1Address}`);
      deployed['Token1'] = tok1Address;
   
      const tok2 = await ethers.getContractFactory('Token');
      const tok2Instance = await tok2.deploy('Token2', 'TOK2');
      await tok2Instance.deployed();
      const tok2Address = tok2Instance.address;
      console.log(`Deploy: Token2 deployed to : ${tok2Address}`);
      deployed['Token2'] = tok2Address;
   
      const tok3 = await ethers.getContractFactory('Token');
      const tok3Instance = await tok3.deploy('Token3', 'TOK3');
      await tok3Instance.deployed();
      const tok3Address = tok3Instance.address;
      console.log(`Deploy: Token3 deployed to : ${tok3Address}`);
      deployed['Token3'] = tok3Address;
   
      const LiquidityPools = [
         proxyInstance,
         poolInstance1,
         poolInstance2,
         poolInstance3,
         poolInstance4,
      ];
   
      const Tokens = [wethInstance, tok1Instance, tok2Instance, tok3Instance];
   
      console.log(`----- MINTS AND APPROVALS -----`);
   
      //Deposit DEV to get WETH
      console.log(`WETH: minting ${wethMint} for ${deployerAddress}`);
      tx = await wethInstance.deposit({
         value: ethers.utils.parseEther(wethMint),
      });
      await tx.wait();
   
      //Approve Pool on tokens
      for (i = 0; i <= LiquidityPools.length - 1; i++) {
         for (j = 0; j <= Tokens.length - 1; j++) {
            if (i === 0) {
               console.log(`Proxy: approving Proxy in ${Tokens[j].address}`);
            } else {
               console.log(
                  `LiquidityPool${i}: approving LiquidityPool${i} in ${Tokens[j].address}`
               );
            }
   
            tx = await Tokens[j].approve(
               LiquidityPools[i].address,
               ethers.utils.parseEther(approvalAmount)
            );
            await tx.wait();
         }
      }
   
      //Bind Tokens in Desyn Pool
      for (i = 1; i <= LiquidityPools.length - 1; i++) {
         console.log(`\n\n----- LIQUDITY POOL ${i} OPERATIONS -----`);
         for (j = 0; j <= Tokens.length - 1; j++) {
            let weight = pools[`pool${i}`].weight[`tok${j}`];
            let bind = pools[`pool${i}`].bind[`tok${j}`];
   
            if (weight != '0') {
               console.log(
                  `LiquidityPool${i}: binding ${bind} WETH with weight ${weight}`
               );
   
               tx = await LiquidityPools[i].bind(
                  Tokens[j].address,
                  ethers.utils.parseEther(bind),
                  ethers.utils.parseEther(weight)
               );
               await tx.wait();
            }
         }
   
         // Set Swap Fee
         console.log(`LiquidityPool${i}: set swap fee`);
         tx = await LiquidityPools[i].setSwapFee(ethers.utils.parseEther(swapFee));
         await tx.wait();
   
         // Set Public Swap
         console.log(`LiquidityPool${i}: set public Swap`);
         tx = await LiquidityPools[i].setPublicSwap(true);
         await tx.wait();
   
         // Finalize Pool
         console.log(`LiquidityPool${i}: finalize`);
         tx = await LiquidityPools[i].finalize();
         await tx.wait();
      }
   }

   console.log(deployed);
}

deploy()
   .then(() => process.exit(0))
   .catch((error) => {
      console.error(error);
      process.exit(1);
   });
