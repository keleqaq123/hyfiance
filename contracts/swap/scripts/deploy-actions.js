const { ethers } = require('hardhat');

// Variables
let tx;

// Deploy function
async function deploy() {
   console.log(`----- DEPLOYMENTS -----`);
   [account1] = await ethers.getSigners();

   deployerAddress = account1.address;
   console.log(
      `Deploying desyn actions and DS Proxy using ${deployerAddress}`
   );

   // Deploy Actions
   const bActions = await ethers.getContractFactory('Actions');
   const bActionsInstance = await bActions.deploy();
   await bActionsInstance.deployed();
   console.log(`Deploy: Actions deployed to : ${bActionsInstance.address}`);

}

deploy()
   .then(() => process.exit(0))
   .catch((error) => {
      console.error(error);
      process.exit(1);
   });
