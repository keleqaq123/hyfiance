
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
        const CNNFT = await hre.ethers.getContractFactory("CNNFT");
        const cNNFT = await CNNFT.deploy();
        await cNNFT.deployed();
        console.log("cNNFT deployed to:", cNNFT.address);
     //  deploy LunaDao
        const LunaDao = await hre.ethers.getContractFactory("LunaDao");
        const lunaDao = await LunaDao.deploy(cNNFT.address,exchange.address);
        await lunaDao.deployed();
        console.log("lunaDao deployed to:", lunaDao.address);
      //set tokenBalanceBool
      const time1 =  await lunaDao.getTime();
      console.log("time1:",time1.toString());
    var tx =  await cNNFT.setAdmin(lunaDao.address);
    await tx.wait();
    tx =   await cNNFT.createNFT("0x597e91c8F08956096Ba563B181d9d8F08ef70c3B",1,time1.toString(),time1.toString()+"0","388888888",time1.toString()+"0",0);
      await tx.wait();
      tx =   await cNNFT.createNFT("0xF67187F1c257226F232DcdA6Ef5cE65c6f9200f6",1,time1.toString(),time1.toString()+"0","388888888",time1.toString()+"0",0);
      await tx.wait();
      //设置5星
      tx =  await lunaDao.setStarList("0xF67187F1c257226F232DcdA6Ef5cE65c6f9200f6",5);
      await tx.wait()
      //测试增加天数
      const nftAccount1 = await cNNFT.getTokenIdChickAttribute(1);
      const nftAccount2 = await cNNFT.getTokenIdChickAttribute(2);
      console.log("nftAccount1 addDayTime:",nftAccount1.endTime.toString());
      console.log("nftAccount1 addAmount:",nftAccount1.addAmount.toString());
      console.log("nftAccount2 addDayTime:",nftAccount2.endTime.toString());
      console.log("nftAccount2 addAmount:",nftAccount2.addAmount.toString());
      const test1 = await lunaDao.getAddTotalToken(1,3);
      console.log("test1",test1.toString());
      tx=   await lunaDao.setInvter("0x597e91c8F08956096Ba563B181d9d8F08ef70c3B","0xF67187F1c257226F232DcdA6Ef5cE65c6f9200f6");
      await tx.wait()
      tx= await lunaDao.setTokenBalanceBool("0x597e91c8F08956096Ba563B181d9d8F08ef70c3B",true);
      await tx.wait()
      tx= await lunaDao.setIsStartIdo(true);
      await tx.wait()
      tx= await lunaDao.setShengAdr(exchange.address,"0x597e91c8F08956096Ba563B181d9d8F08ef70c3B","0xF67187F1c257226F232DcdA6Ef5cE65c6f9200f6");
      await tx.wait()
      console.log(123);
      tx=   await lunaDao.idoBnb("0x597e91c8F08956096Ba563B181d9d8F08ef70c3B",1,{value:utils.parseEther("1")});
      await tx.wait()
      //  //测试45%的分配
    //   await lunaDao.connect(accounts[3]).idoBnb("0x597e91c8F08956096Ba563B181d9d8F08ef70c3B",1,{value:utils.parseEther("1")});
        
    // tx =   await lunaDao.idoBnb("0x597e91c8F08956096Ba563B181d9d8F08ef70c3B",2,{value:utils.parseEther("3")});
    //   await tx.wait()
      //测试增加天数
 const nftAccount11 = await cNNFT.getTokenIdChickAttribute(1);
 const nftAccount21 = await cNNFT.getTokenIdChickAttribute(2);
 console.log("nftAccount1 addDayTime:",nftAccount11.addDayTime.toString());
 console.log("nftAccount1 addAmount:",nftAccount11.addAmount.toString());
 console.log("nftAccount2 addDayTime:",nftAccount21.addDayTime.toString());
 console.log("nftAccount2 addAmount:",nftAccount21.addAmount.toString());
 //测试领token

// for(var i = 0;i<10;i++){
//   const num1 = await lunaDao.releasableAmount(4);
//   const num2 = await lunaDao.releasableAmount(5);
//   console.log(num1.toString())
//   console.log(num1.toString())
// }
  //      //原点位升级
  //     const www = await cNNFT.tokenOfOwnerByIndex(accounts[0].address,0);
  //     console.log("nft2 tokenId:",www.toString());
  //     const nftNum = await cNNFT.balanceOf(accounts[0].address);
  //     console.log("nft amount:",nftNum.toString());
  //     const nft2 = await cNNFT.getTokenIdChickAttribute(www.toString());
  //     console.log("nft2 object:",nft2);
  //     console.log("ido success"); 
  //     console.log("account1",accounts[1].address);
  //     const invter = await lunaDao.invters(accounts[0].address);
  //     console.log(invter);
  //     //测试升v1
  //     await lunaDao.setOneList(accounts[1].address,10);
  //     for(var i =4;i<14;i++){
  //       await lunaDao.connect(accounts[i]).idoBnb(accounts[0].address,5,{value:utils.parseEther("24")});
  //     }
  //     for(var i =14;i<24;i++){
  //       await lunaDao.connect(accounts[i]).idoBnb(accounts[3].address,5,{value:utils.parseEther("24")});
  //     }

  //   const level0 =   await lunaDao.starList(accounts[0].address);
  //   console.log("level0",level0.toString())
  //   const level3 =   await lunaDao.starList(accounts[3].address);
  //   console.log("level3",level3.toString())
  //   const level1 =   await lunaDao.starList(accounts[1].address);
  //   console.log("level1",level1.toString())
  //   const manyListAccmount1 = await lunaDao.manyList(accounts[1].address);
  //   console.log("manyListAccmount1:",manyListAccmount1.toString());
  //  //测试兑换
  //  await lunaDao.approve(exchange.address,"10000000000000000000000000000");
  //  await exchange.setOpen(true);
  //  await exchange.setTokenInfo(lunaDao.address,9);
  //  await exchange.exchangeHandle(1000);
  //  const userEx = await exchange.userRecord(accounts[0].address);
  //  console.log("userEx",userEx.toString())
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
