const { ethers } = require('hardhat');

// Variables
let tx;
const deployed = {};

// Deploy function
async function deploy() {
   console.log(`----- DEPLOYMENTS -----`);
   [account1] = await ethers.getSigners();

   deployerAddress = account1.address;
   console.log(
      `Deploying desyn actions and DS Proxy using ${deployerAddress}`
   );

   //Deploy DSProxyFactory
   const dsProxy = await ethers.getContractFactory('DSProxyFactory');
   const dsProxyInstance = await dsProxy.deploy();
   await dsProxyInstance.deployed();
   console.log(
      `Deploy: DSProxyFactory deployed to : ${dsProxyInstance.address}`
   );
   deployed['DSProxyFactory'] = dsProxyInstance.address;

   //Deploy DSProxyRegistry
   const dsProxyRegistry = await ethers.getContractFactory('ProxyRegistry');
   const dsProxyRegInstance = await dsProxyRegistry.deploy(
      dsProxyInstance.address
   );
   await dsProxyRegInstance.deployed();
   console.log(
      `Deploy: DSProxyRegistry deployed to : ${dsProxyRegInstance.address}`
   );
   deployed['ProxyRegistry'] = dsProxyRegInstance.address;

   //Deploy Actions
   const bActions = await ethers.getContractFactory('Actions');
   const bActionsInstance = await bActions.deploy();
   await bActionsInstance.deployed();
   console.log(`Deploy: Actions deployed to : ${bActionsInstance.address}`);
   deployed['Actions'] = bActionsInstance.address;

   console.log(deployed);

}

deploy()
   .then(() => process.exit(0))
   .catch((error) => {
      console.error(error);
      process.exit(1);
   });
