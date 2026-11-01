const { expect } = require('chai');
const { ethers } = require('hardhat');

describe('CustosKBW2026', function () {
  let nft, owner, alice, bob;
  beforeEach(async function () {
    [owner, alice, bob] = await ethers.getSigners();
    nft = await (await ethers.getContractFactory('CustosKBW2026')).deploy('data:application/json;base64,e30=');
    await nft.waitForDeployment();
  });
  it('has a fixed 2026 supply, free mint and one mint per wallet', async function () {
    expect(await nft.MAX_SUPPLY()).to.equal(2026n);
    expect(await nft.mintPrice()).to.equal(0n);
    expect(await nft.WALLET_LIMIT()).to.equal(1n);
    await expect(nft.connect(alice).publicMint(1)).to.emit(nft,'Minted').withArgs(alice.address,1n);
    expect(await nft.ownerOf(1)).to.equal(alice.address);
    expect(await nft.tokenURI(1)).to.equal('data:application/json;base64,e30=');
    await expect(nft.connect(alice).publicMint(1)).to.be.revertedWithCustomError(nft,'WalletLimitReached');
  });
  it('rejects payment and multiple quantities without minting', async function () {
    await expect(nft.connect(alice).publicMint(1,{value:1n})).to.be.revertedWithCustomError(nft,'IncorrectPayment');
    await expect(nft.connect(alice).publicMint(2)).to.be.revertedWithCustomError(nft,'IncorrectQuantity');
    expect(await nft.totalSupply()).to.equal(0n);
  });
  it('only the owner can pause minting or update metadata', async function () {
    await expect(nft.connect(alice).setMintOpen(false)).to.be.revertedWithCustomError(nft,'OwnableUnauthorizedAccount');
    await expect(nft.connect(alice).setMetadataURI('ipfs://new')).to.be.revertedWithCustomError(nft,'OwnableUnauthorizedAccount');
    await nft.setMintOpen(false);
    await expect(nft.connect(bob).publicMint(1)).to.be.revertedWithCustomError(nft,'MintClosed');
    await nft.setMetadataURI('ipfs://new');
    await nft.setMintOpen(true);
    await nft.connect(bob).publicMint(1);
    expect(await nft.tokenURI(1)).to.equal('ipfs://new');
  });
});
