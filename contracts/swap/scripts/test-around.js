const { ethers } = require('hardhat');

// Variables
let tx;
let txReceipt;
const approvalAmount = '1000000';
const wethMint = '1000';
tokTransfer = '500';

// Pool Configuration
const wethBind = '100';
const wethWeight = '5';
const tok1Bind = '200';
const tok1Weight = '5';
const tok2Bind = '303';
const tok2Weight = '5';
const tok3Bind = '400';
const tok3Weight = '5';
const swapFee = '0.05';

//Swap
minAmtOut = '0';
maxPrice = '5000000000000000000000000000';
const amtIn = '1';

// Deploy function
async function test() {
   /*
   ------------------------------------------
   */
   console.log(`----- DEPLOYMENTS -----`);
   [account1] = await ethers.getSigners();

   deployerAddress = account1.address;
   console.log(`Deploying contracts using ${deployerAddress}`);

   //Deploy Factory
   const factory = await ethers.getContractFactory('Factory');
   const factoryInstance = await factory.deploy();
   await factoryInstance.deployed();
   console.log(`Deploy: Factory deployed to : ${factoryInstance.address}`);

   //Deploy New Pool - Get Address and Create Instance
   tx = await factoryInstance.newLiquidityPool();
   txReceipt = await tx.wait();
   const poolAddress1 = txReceipt.logs[1].address;
   console.log(`Deploy: LiquidityPool1 deployed to : ${poolAddress1}`);
   const pool1 = await ethers.getContractFactory('LiquidityPool');
   const poolInstance1 = pool1.attach(poolAddress1);
   tx = await factoryInstance.newLiquidityPool();
   txReceipt = await tx.wait();
   const poolAddress2 = txReceipt.logs[1].address;
   console.log(`Deploy: LiquidityPool2 deployed to : ${poolAddress2}`);
   const pool2 = await ethers.getContractFactory('LiquidityPool');
   const poolInstance2 = pool2.attach(poolAddress2);

   //Deploy WETH
   const weth = await ethers.getContractFactory('WETH');
   const wethInstance = await weth.deploy();
   await wethInstance.deployed();
   wethAddress = wethInstance.address;
   console.log(`Deploy: WETH deployed to : ${wethAddress}`);

   //Deploy ExchangeProxy
   const proxy = await ethers.getContractFactory('ExchangeProxy');
   const proxyInstance = await proxy.deploy(wethAddress);
   await proxyInstance.deployed();
   console.log(`Deploy: Proxy deployed to : ${proxyInstance.address}`);

   //Deploy Multicall (needed for Interface)
   const multicall = await ethers.getContractFactory('Multicall');
   const multicallInstance = await multicall.deploy();
   await multicallInstance.deployed();
   console.log(`Deploy: Multicall deployed to : ${multicallInstance.address}`);

   //Deploy sorMultiCall
   const sorMC = await ethers.getContractFactory('sorMultiCall');
   const sorMCInstance = await sorMC.deploy();
   await sorMCInstance.deployed();
   console.log(`Deploy: sorMultiCall deployed to : ${sorMCInstance.address}`);

   //Deploy Tokens
   const tok1 = await ethers.getContractFactory('Token');
   const tok1Instance = await tok1.deploy('Token1', 'TOK1');
   await tok1Instance.deployed();
   const tok1Address = tok1Instance.address;
   console.log(`Deploy: Token1 deployed to : ${tok1Address}`);

   const tok2 = await ethers.getContractFactory('Token');
   const tok2Instance = await tok2.deploy('Token2', 'TOK2');
   await tok2Instance.deployed();
   const tok2Address = tok2Instance.address;
   console.log(`Deploy: Token2 deployed to : ${tok2Address}`);

   const tok3 = await ethers.getContractFactory('Token');
   const tok3Instance = await tok3.deploy('Token3', 'TOK3');
   await tok3Instance.deployed();
   const tok3Address = tok3Instance.address;
   console.log(`Deploy: Token3 deployed to : ${tok3Address}`);

   /*
   ------------------------------------------
   */
   console.log(`\n\n----- MINTS AND APPROVALS -----`);

   //Deposit DEV to get WETH
   console.log(`WETH: minting ${wethMint} for ${deployerAddress}`);
   tx = await wethInstance.deposit({
      value: ethers.utils.parseEther(wethMint),
   });
   await tx.wait();

   //Approve Pool1 on tokens
   console.log(`LiquidityPool1: approving LiquidityPool1 on WETH`);
   tx = await wethInstance.approve(
      poolAddress1,
      ethers.utils.parseEther(approvalAmount)
   );
   await tx.wait();
   console.log(`LiquidityPool1: approving LiquidityPool1 on Token1`);
   tx = await tok1Instance.approve(
      poolAddress1,
      ethers.utils.parseEther(approvalAmount)
   );
   await tx.wait();
   console.log(`LiquidityPool1: approving LiquidityPool1 on Token2`);
   tx = await tok2Instance.approve(
      poolAddress1,
      ethers.utils.parseEther(approvalAmount)
   );
   await tx.wait();
   console.log(`LiquidityPool1: approving LiquidityPool1 on Token3`);
   tx = await tok3Instance.approve(
      poolAddress1,
      ethers.utils.parseEther(approvalAmount)
   );
   await tx.wait();

   //Approve Pool2 on tokens
   console.log(`LiquidityPool2: approving LiquidityPool2 on WETH`);
   tx = await wethInstance.approve(
      poolAddress2,
      ethers.utils.parseEther(approvalAmount)
   );
   await tx.wait();
   console.log(`LiquidityPool2: approving LiquidityPool2 on Token1`);
   tx = await tok1Instance.approve(
      poolAddress2,
      ethers.utils.parseEther(approvalAmount)
   );
   await tx.wait();
   console.log(`LiquidityPool2: approving LiquidityPool2 on Token2`);
   tx = await tok2Instance.approve(
      poolAddress2,
      ethers.utils.parseEther(approvalAmount)
   );
   await tx.wait();
   console.log(`LiquidityPool2: approving LiquidityPool2 on Token3`);
   tx = await tok3Instance.approve(
      poolAddress2,
      ethers.utils.parseEther(approvalAmount)
   );
   await tx.wait();

   //Approve Proxy on tokens
   console.log(`ExchangeProxy: approving ExchangeProxy on WETH`);
   tx = await wethInstance.approve(
      proxyInstance.address,
      ethers.utils.parseEther(approvalAmount)
   );
   await tx.wait();
   console.log(`ExchangeProxy: approving ExchangeProxy on Token1`);
   tx = await tok1Instance.approve(
      proxyInstance.address,
      ethers.utils.parseEther(approvalAmount)
   );
   await tx.wait();
   console.log(`ExchangeProxy: approving ExchangeProxy on Token2`);
   tx = await tok2Instance.approve(
      proxyInstance.address,
      ethers.utils.parseEther(approvalAmount)
   );
   await tx.wait();
   console.log(`LiquidityPool2: approving LiquidityPool2 on Token3`);
   tx = await tok3Instance.approve(
      proxyInstance.address,
      ethers.utils.parseEther(approvalAmount)
   );
   await tx.wait();

   /*
   ------------------------------------------
   */
   console.log(`\n\n----- LIQUDITY POOL 1 OPERATIONS -----`);
   //Bind Tokens in Desyn Pool 1
   console.log(`LiquidityPool1: binding ${wethBind} WETH with weight ${wethWeight}`);
   tx = await poolInstance1.bind(
      wethAddress,
      ethers.utils.parseEther(wethBind),
      ethers.utils.parseEther(wethWeight)
   );
   await tx.wait();
   console.log(`LiquidityPool1: binding ${tok1Bind} Tok1 with weight ${tok1Weight}`);
   tx = await poolInstance1.bind(
      tok1Address,
      ethers.utils.parseEther(tok1Bind),
      ethers.utils.parseEther(tok1Weight)
   );
   await tx.wait();
   console.log(`LiquidityPool1: binding ${tok2Bind} Tok2 with weight ${tok2Weight}`);
   tx = await poolInstance1.bind(
      tok2Address,
      ethers.utils.parseEther(tok2Bind),
      ethers.utils.parseEther(tok2Weight)
   );
   await tx.wait();

   console.log('----');
   await checkBalances(
      wethAddress,
      tok1Address,
      tok2Address,
      tok3Address,
      deployerAddress
   );
   await checkWeights(poolAddress1, wethAddress, tok1Address);
   console.log('----\n');

   //Unbinding tok2 (remove token from Pool)
   console.log(`LiquidityPool1: unbinding TOK2`);
   tx = await poolInstance1.unbind(tok2Address);
   await tx.wait();

   console.log('----');
   await checkBalances(
      wethAddress,
      tok1Address,
      tok2Address,
      tok3Address,
      deployerAddress
   );
   await checkWeights(poolAddress1, wethAddress, tok1Address);
   console.log('----\n');

   //Rebind tok2
   console.log(`LiquidityPool1: re-binding ${tok2Bind} Tok2 with weight ${tok2Weight}`);
   tx = await poolInstance1.bind(
      tok2Address,
      ethers.utils.parseEther(tok2Bind),
      ethers.utils.parseEther(tok2Weight)
   );

   console.log('----');
   await checkBalances(
      wethAddress,
      tok1Address,
      tok2Address,
      tok3Address,
      deployerAddress
   );
   await checkWeights(poolAddress1, wethAddress, tok1Address, tok2Address);
   console.log('----\n');

   // Set Swap Fee
   console.log(`LiquidityPool: set swap fee`);
   tx = await poolInstance1.setSwapFee(ethers.utils.parseEther(swapFee));
   await tx.wait();

   // Set Public Swap
   console.log(`LiquidityPool: set public Swap`);
   tx = await poolInstance1.setPublicSwap(true);
   await tx.wait();

   // Finalize Pool
   console.log(`LiquidityPool: finalize`);
   tx = await poolInstance1.finalize();
   await tx.wait();

   /*
   ------------------------------------------
   */
   console.log(`\n\n----- LIQUDITY POOL 2 OPERATIONS -----`);
   //Bind Tokens in Desyn Pool 2
   console.log(`LiquidityPool2: binding ${wethBind} WETH with weight ${wethWeight}`);
   tx = await poolInstance2.bind(
      wethAddress,
      ethers.utils.parseEther(wethBind),
      ethers.utils.parseEther(wethWeight)
   );
   await tx.wait();
   console.log(`LiquidityPool2: binding ${tok1Bind} Tok1 with weight ${tok1Weight}`);
   tx = await poolInstance2.bind(
      tok1Address,
      ethers.utils.parseEther(tok1Bind),
      ethers.utils.parseEther(tok1Weight)
   );
   await tx.wait();
   console.log(`LiquidityPool2: binding ${tok2Bind} Tok2 with weight ${tok2Weight}`);
   tx = await poolInstance2.bind(
      tok2Address,
      ethers.utils.parseEther(tok2Bind),
      ethers.utils.parseEther(tok2Weight)
   );
   await tx.wait();
   console.log(`LiquidityPool2: binding ${tok3Bind} Tok3 with weight ${tok3Weight}`);
   tx = await poolInstance2.bind(
      tok3Address,
      ethers.utils.parseEther(tok3Bind),
      ethers.utils.parseEther(tok3Weight)
   );
   await tx.wait();

   console.log('----');
   await checkBalances(
      wethAddress,
      tok1Address,
      tok2Address,
      tok3Address,
      deployerAddress
   );
   await checkWeights(
      poolAddress2,
      wethAddress,
      tok1Address,
      tok2Address,
      tok3Address
   );
   console.log('----\n');

   // Set Swap Fee
   console.log(`LiquidityPool: set swap fee`);
   tx = await poolInstance2.setSwapFee(ethers.utils.parseEther(swapFee));
   await tx.wait();

   // Set Public Swap
   console.log(`LiquidityPool: set public Swap`);
   tx = await poolInstance2.setPublicSwap(true);
   await tx.wait();

   // Finalize Pool
   console.log(`LiquidityPool: finalize`);
   tx = await poolInstance2.finalize();
   await tx.wait();

   /*
   ------------------------------------------
   */
   console.log(`\n\n----- LIQUDITY POOL 1 SWAPS -----`);
   // Swap Exact Amount in
   console.log(`LiquidityPool1: exact swapping ${amtIn} of WETH for Tok1`);
   tx = await poolInstance1.swapExactAmountIn(
      wethAddress,
      ethers.utils.parseEther(amtIn),
      tok1Address,
      ethers.utils.parseEther(minAmtOut),
      ethers.utils.parseEther(maxPrice)
   );
   await tx.wait();

   console.log('----');
   await checkBalances(
      wethAddress,
      tok1Address,
      tok2Address,
      tok3Address,
      deployerAddress
   );
   console.log('----\n');

   /*
   ------------------------------------------
   */
   console.log(`----- LIQUDITY POOL2  SWAPS -----`);
   console.log(`LiquidityPool2: exact swapping ${amtIn} of Tok2 for Tok3`);
   tx = await poolInstance2.swapExactAmountIn(
      tok2Address,
      ethers.utils.parseEther(amtIn),
      tok3Address,
      ethers.utils.parseEther(minAmtOut),
      ethers.utils.parseEther(maxPrice)
   );
   await tx.wait();

   console.log('----');
   await checkBalances(
      wethAddress,
      tok1Address,
      tok2Address,
      tok3Address,
      deployerAddress
   );
   console.log('----\n');

   /*
   ------------------------------------------
   */
   /*console.log(`----- PROXY SWAP -----`);

   //Define tupple for Exchange Swap
   const swaps = [
      [
         poolAddress1,
         '500000000000000000',
         '0',
         '500000000000000000000000000000',
      ],
      [
         poolAddress2,
         '500000000000000000',
         '0',
         '500000000000000000000000000000',
      ],
   ];

   // Swap Exact Amount in
   console.log(`BatchSwap: exact swapping of ${amtIn} Tok1 for Tok2`);
   tx = await proxyInstance.batchSwapExactIn(
      swaps,
      tok1Address,
      tok2Address,
      ethers.utils.parseEther(amtIn),
      ethers.utils.parseEther('0')
   );
   await tx.wait();

   console.log('----');
   await checkBalances(
      wethAddress,
      tok1Address,
      tok2Address,
      tok3Address,
      deployerAddress
   );
   console.log('----\n');*/
}

test()
   .then(() => process.exit(0))
   .catch((error) => {
      console.error(error);
      process.exit(1);
   });

const checkWeights = async (
   poolAddress,
   wethAddress,
   tok1Address,
   tok2Address,
   tok3Address
) => {
   // Create Pool Instance
   const poolInstance = await ethers.getContractAt('LiquidityPool', poolAddress);

   // Check Normalized and Denormalized weights
   let wethNormWeight;
   let wethDenormWeight;
   if (wethAddress) {
      wethNormWeight = ethers.utils.formatEther(
         await poolInstance.getNormalizedWeight(wethAddress)
      );
      wethDenormWeight = ethers.utils.formatEther(
         await poolInstance.getDenormalizedWeight(wethAddress)
      );
   }

   let tok1NormWeight;
   let tok1DenormWeight;
   if (tok1Address) {
      tok1NormWeight = ethers.utils.formatEther(
         await poolInstance.getNormalizedWeight(tok1Address)
      );
      tok1DenormWeight = ethers.utils.formatEther(
         await poolInstance.getDenormalizedWeight(tok1Address)
      );
   }

   let tok2NormWeight;
   let tok2DenormWeight;
   if (tok2Address) {
      tok2NormWeight = ethers.utils.formatEther(
         await poolInstance.getNormalizedWeight(tok2Address)
      );

      tok2DenormWeight = ethers.utils.formatEther(
         await poolInstance.getDenormalizedWeight(tok2Address)
      );
   }

   let tok3NormWeight;
   let tok3DenormWeight;
   if (tok3Address) {
      tok3NormWeight = ethers.utils.formatEther(
         await poolInstance.getNormalizedWeight(tok3Address)
      );

      tok3DenormWeight = ethers.utils.formatEther(
         await poolInstance.getDenormalizedWeight(tok3Address)
      );
   }

   console.log(
      `Normalized Weights: WETH ${wethNormWeight} - tok1 ${tok1NormWeight} - tok2 ${tok2NormWeight} - tok3 ${tok3NormWeight}`
   );
   console.log(
      `Denormalized Weights: WETH ${wethDenormWeight} - tok1 ${tok1DenormWeight} - tok2 ${tok2DenormWeight} - tok3 ${tok3DenormWeight}`
   );
};

const checkBalances = async (
   wethAddress,
   tok1Address,
   tok2Address,
   tok3Address,
   ownerAddress
) => {
   // Create Token Instances
   const wethInstance = await ethers.getContractAt('Token', wethAddress);
   const tok1Instance = await ethers.getContractAt('Token', tok1Address);
   const tok2Instance = await ethers.getContractAt('Token', tok2Address);
   const tok3Instance = await ethers.getContractAt('Token', tok3Address);

   // Check New Balance of Tokens
   const wethBalance = ethers.utils.formatEther(
      await wethInstance.balanceOf(ownerAddress)
   );
   const tok1Balance = ethers.utils.formatEther(
      await tok1Instance.balanceOf(ownerAddress)
   );
   const tok2Balance = ethers.utils.formatEther(
      await tok2Instance.balanceOf(ownerAddress)
   );
   const tok3Balance = ethers.utils.formatEther(
      await tok3Instance.balanceOf(ownerAddress)
   );
   console.log(
      `Balances of ${ownerAddress}: WETH ${wethBalance} - tok1 ${tok1Balance} - tok2 ${tok2Balance} - - tok3 ${tok3Balance}`
   );
};
