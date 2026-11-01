const hre = require('hardhat')
async function main(){
  const {ethers}=hre
  const [deployer]=await ethers.getSigners()
  const Factory=await ethers.getContractFactory('UniswapV2Factory')
  const f=await Factory.deploy(deployer.address)
  await f.deployed()
  console.log('factory', f.address)
  console.log('initCodeHash', await f.INIT_CODE_PAIR_HASH())
}
main().catch(e=>{console.error(e);process.exit(1)})
