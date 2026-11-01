
const hre = require("hardhat");
const run=hre.run;
const ethers=hre.ethers;
async function main() {
        //compile
        await run("compile");
        //accounts
        const accounts = await ethers.getSigners();
        const { utils } = ethers;
        //deploy Exchange
        const Exchange = await hre.ethers.getContractFactory("Exchange");
        const exchange = await Exchange.deploy();
        await exchange.deployed();
        console.log("exchange deployed to:", exchange.address);
        //deploy CNNFT
        const CNNFT = await hre.ethers.getContractFactory("TCNFT");
        const cNNFT = await CNNFT.deploy();
        await cNNFT.deployed();
        console.log("cNNFT deployed to:", cNNFT.address);
     //  deploy LunaDao
        const LunaDao = await hre.ethers.getContractFactory("ThecroodsIdo");
        const lunaDao = await LunaDao.deploy(cNNFT.address,exchange.address);
        await lunaDao.deployed();
        console.log("lunaDao deployed to:", lunaDao.address);
      //set tokenBalanceBool
      const time1 =  await lunaDao.getTime();
      console.log("time1:",time1.toString());
      await cNNFT.setAdmin(lunaDao.address);
      await cNNFT.createNFT(accounts[1].address,1,time1.toString(),time1.toString()+"0","388888888",time1.toString()+"0",0);
      await cNNFT.createNFT(accounts[2].address,1,time1.toString(),time1.toString()+"0","388888888",time1.toString()+"0",0);
      //设置5星
      await lunaDao.setStarList(accounts[2].address,5);
      //测试增加天数
      const nftAccount1 = await cNNFT.getTokenIdChickAttribute(1);
      const nftAccount2 = await cNNFT.getTokenIdChickAttribute(2);
      console.log("nftAccount1 addDayTime:",nftAccount1.endTime.toString());
      console.log("nftAccount1 addAmount:",nftAccount1.addAmount.toString());
      console.log("nftAccount2 addDayTime:",nftAccount2.endTime.toString());
      console.log("nftAccount2 addAmount:",nftAccount2.addAmount.toString());
      const test1 = await lunaDao.getAddTotalToken(1,3);
      console.log("test1",test1.toString());
      await lunaDao.setInvter(accounts[1].address,accounts[2].address);
      await lunaDao.setTokenBalanceBool(accounts[1].address,true);
      await lunaDao.setIsStartIdo(true);
      await lunaDao.setShengAdr(exchange.address,accounts[4].address,accounts[5].address);
      console.log(123);
      await lunaDao.idoBnb(accounts[1].address,1,{value:utils.parseEther("1")});

    //  //测试45%的分配
      await lunaDao.connect(accounts[3]).idoBnb(accounts[1].address,1,{value:utils.parseEther("1")});
      const nftAccount11 = await cNNFT.getTokenIdChickAttribute(3);
      console.log("nftAccount1 addDayTime:",nftAccount11.startTime.toString());
      console.log("nftAccount1 addDayTime:",nftAccount11.totalAmount.toString());
      console.log("nftAccount1 addDayTime:",nftAccount11.endTime.toString());
      console.log("nftAccount1 addDayTime:",nftAccount11.addDayTime.toString());
      console.log("nftAccount1 addAmount:",nftAccount11.addAmount.toString());
      await lunaDao.idoBnb(accounts[1].address,2,{value:utils.parseEther("3")});
 //测试增加天数

 const nftAccount21 = await cNNFT.getTokenIdChickAttribute(5);

//  console.log("nftAccount1 addAmount:",nftAccount11.totalAmount.toString());
console.log("nftAccount2 addDayTime:",nftAccount21.startTime.toString());
console.log("nftAccount2 addDayTime:",nftAccount21.totalAmount.toString());
 console.log("nftAccount2 addDayTime:",nftAccount21.endTime.toString());
 console.log("nftAccount2 addDayTime:",nftAccount21.addDayTime.toString());
 console.log("nftAccount2 addAmount:",nftAccount21.addAmount.toString());
 //测试领token
 await cNNFT.setAddUserAmount1(3,10);
 const nftAccount111 = await cNNFT.getTokenIdChickAttribute(3);
 console.log("nftAccount1 addDayTime:",nftAccount111.startTime.toString());
 console.log("nftAccount1 addDayTime:",nftAccount111.endTime.toString());
 console.log("nftAccount1 addAmount:",nftAccount111.addAmount.toString());
 await lunaDao.setClaimBool(true);
//  for(var i = 0;i<10;i++){
//   const num1 = await lunaDao.releasableAmount(3);
//   // const num2 = await lunaDao.releasableAmount(5);
//   const time1 =  await lunaDao.getTime();
//   console.log("time1:",time1.toString());
//   await lunaDao.claimToken();
//  const munh = await lunaDao.balanceOf(accounts[2].address);
//  const munh1 = await lunaDao.balanceOf(accounts[0].address);
//  console.log(munh.toString())
//   console.log(munh1.toString())
// }
//测试全网分红
       await lunaDao.shareToken();
       const munh = await lunaDao.balanceOf(accounts[2].address);
       console.log(munh.toString())

 // 测试muticall
   //     deploy ThecroodsIdoMuticall
       const ThecroodsIdoMuticall = await hre.ethers.getContractFactory("ThecroodsIdoMuticall");
       const thecroodsIdoMuticall = await ThecroodsIdoMuticall.deploy(cNNFT.address,lunaDao.address);
       await thecroodsIdoMuticall.deployed();
       console.log("thecroodsIdoMuticall deployed to:", thecroodsIdoMuticall.address);
  const info1 = await thecroodsIdoMuticall.getUserInfoIdo(accounts[0].address);
  console.log(info1[0].toString());
  console.log(info1[1].toString());
  console.log(info1[2].toString());
  const info2 = await thecroodsIdoMuticall.getUserInfoInvter(accounts[0].address);
  console.log(info2);

  // console.log(num2.toString())


       //原点位升级
      const www = await cNNFT.tokenOfOwnerByIndex(accounts[0].address,0);
      console.log("nft2 tokenId:",www.toString());
      const nftNum = await cNNFT.balanceOf(accounts[0].address);
      console.log("nft amount:",nftNum.toString());
      const nft2 = await cNNFT.getTokenIdChickAttribute(www.toString());
      console.log("nft2 object:",nft2);
      console.log("ido success"); 
      console.log("account1",accounts[1].address);
      const invter = await lunaDao.invters(accounts[0].address);
      console.log(invter);
      //测试升v1
      await lunaDao.setOneList(accounts[1].address,10);
      for(var i =4;i<14;i++){
        await lunaDao.connect(accounts[i]).idoBnb(accounts[0].address,5,{value:utils.parseEther("24")});
      }
      for(var i =14;i<24;i++){
        await lunaDao.connect(accounts[i]).idoBnb(accounts[3].address,5,{value:utils.parseEther("24")});
      }

    const level0 =   await lunaDao.starList(accounts[0].address);
    console.log("level0",level0.toString())
    const level3 =   await lunaDao.starList(accounts[3].address);
    console.log("level3",level3.toString())
    const level1 =   await lunaDao.starList(accounts[1].address);
    console.log("level1",level1.toString())
    const manyListAccmount1 = await lunaDao.manyList(accounts[1].address);
    console.log("manyListAccmount1:",manyListAccmount1.toString());
   //测试兑换
   await lunaDao.approve(exchange.address,"10000000000000000000000000000");
   await exchange.setOpen(true);
   await exchange.setTokenInfo(lunaDao.address,9);
   await exchange.exchangeHandle(1000);
   const userEx = await exchange.userRecord(accounts[0].address);
   console.log("userEx",userEx.toString())


}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
