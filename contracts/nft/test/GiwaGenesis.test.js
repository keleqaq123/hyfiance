const { expect } = require('chai');
const { ethers } = require('hardhat');

describe('GiwaGenesis', function () {
  const price = ethers.parseEther('0.001');
  let owner;
  let alice;
  let bob;
  let nft;

  beforeEach(async function () {
    [owner, alice, bob] = await ethers.getSigners();
    const factory = await ethers.getContractFactory('GiwaGenesis');
    nft = await factory.deploy(price, 'https://example.com/nft/metadata/');
    await nft.waitForDeployment();
  });

  it('starts with the configured collection rules', async function () {
    expect(await nft.name()).to.equal('GIWA Genesis');
    expect(await nft.symbol()).to.equal('GIWA');
    expect(await nft.MAX_SUPPLY()).to.equal(1111n);
    expect(await nft.WALLET_LIMIT()).to.equal(1n);
    expect(await nft.mintPrice()).to.equal(price);
    expect(await nft.mintOpen()).to.equal(true);
    expect(await nft.baseURI()).to.equal('https://example.com/nft/metadata/');
  });

  it('mints one token and exposes ownership metadata', async function () {
    await expect(nft.connect(alice).publicMint(1, { value: price }))
      .to.emit(nft, 'Minted')
      .withArgs(alice.address, 1n);

    expect(await nft.totalSupply()).to.equal(1n);
    expect(await nft.mintedByWallet(alice.address)).to.equal(1n);
    expect(await nft.ownerOf(1n)).to.equal(alice.address);
    expect(await nft.tokenURI(1n)).to.equal('https://example.com/nft/metadata/1');
  });

  it('rejects duplicate, wrong quantity and wrong payment', async function () {
    await nft.connect(alice).publicMint(1, { value: price });
    await expect(nft.connect(alice).publicMint(1, { value: price }))
      .to.be.revertedWithCustomError(nft, 'WalletLimitReached');
    await expect(nft.connect(bob).publicMint(2, { value: price * 2n }))
      .to.be.revertedWithCustomError(nft, 'IncorrectQuantity');
    await expect(nft.connect(bob).publicMint(1, { value: 0n }))
      .to.be.revertedWithCustomError(nft, 'IncorrectPayment');
  });

  it('allows the owner to pause and update metadata', async function () {
    await nft.setMintOpen(false);
    await expect(nft.connect(alice).publicMint(1, { value: price }))
      .to.be.revertedWithCustomError(nft, 'MintClosed');
    await nft.setBaseURI('https://example.com/new/');
    await nft.setMintOpen(true);
    await nft.connect(alice).publicMint(1, { value: price });
    expect(await nft.tokenURI(1n)).to.equal('https://example.com/new/1');
  });
});
