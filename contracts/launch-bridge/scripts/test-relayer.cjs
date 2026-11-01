// Isolated two-chain test only. Never loads a deployment wallet or public RPC.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {ethers} = require('ethers');
const ganache = require('ganache');
const {BridgeRelayer} = require('../../../apps/relayer/src/relayer.cjs');

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'custos-dual-relayer-'));
  const servers = [], chains = [];
  const artifact = name => JSON.parse(fs.readFileSync(path.resolve(__dirname, '../out/CustosBridge.sol', name+'.json')));
  try {
    for (const [key,chainId] of [['A',47805],['B',47806]]) {
      const server = ganache.server({chain:{chainId}, wallet:{deterministic:true}, logging:{quiet:true}});
      servers.push(server);await server.listen(0,'127.0.0.1');
      const rpc = 'http://127.0.0.1:'+server.address().port;
      const provider = new ethers.providers.JsonRpcProvider(rpc);
      const account = Object.values(server.provider.getInitialAccounts())[0];
      const wallet = new ethers.Wallet(account.secretKey,provider);
      const bridgeArtifact = artifact('CustosBridge'), tokenArtifact = artifact('CustosBridgeToken');
      const bridge = await new ethers.ContractFactory(bridgeArtifact.abi,bridgeArtifact.bytecode,wallet).deploy(wallet.address,wallet.address,chainId);await bridge.deployed();
      const token = await new ethers.ContractFactory(tokenArtifact.abi,tokenArtifact.bytecode,wallet).deploy('Test cUSD','cUSD',ethers.utils.parseEther('100'),wallet.address);await token.deployed();
      await(await token.setBridge(bridge.address)).wait();
      chains.push({key,chainId,rpc,wallet,bridge,token});
    }
    const [a,b] = chains;
    for (const [source,target] of [[a,b],[b,a]]) {
      await(await source.bridge.setTrustedRemote(target.chainId,target.bridge.address)).wait();
      await(await source.bridge.setTokenPair(target.chainId,source.token.address,target.token.address)).wait();
    }
    const r = new BridgeRelayer({
      privateKey:a.wallet.privateKey, stateFile:path.join(dir,'state.json'),
      confirmations:0, receiptConfirmations:1, maxLogBlockRange:100,
      gasLimitMultiplierBps:12500, retryBaseMs:250,retryMaxMs:1000,pendingTxTimeoutMs:10000,
      networks:chains.map(c=>({key:c.key,name:'Isolated '+c.key,chainId:c.chainId,rpc:c.rpc,bridge:c.bridge.address,bridgeToken:c.token.address,startBlock:0})),
    });
    r.log = () => {};
    for (const network of r.networks.values()) await r.validateNetwork(network);
    for (const [source,target] of [[a,b],[b,a]]) {
      const beforeSource = await source.token.balanceOf(source.wallet.address), beforeTarget = await target.token.balanceOf(target.wallet.address);
      const amount = ethers.utils.parseEther('7');
      const receipt = await(await source.bridge.bridgeOut(source.token.address,target.chainId,target.bridge.address,target.wallet.address,amount,'0x')).wait();
      const sent = receipt.events.find(e=>e.event==='MessageSent');
      const id = sent.args.messageId.toLowerCase();
      const deadline = Date.now()+20000;
      while (r.store.message(id)?.status!=='executed' && Date.now()<deadline) {
        await r.poll();await new Promise(resolve=>setTimeout(resolve,100));
      }
      assert.equal(r.store.message(id)?.status,'executed');
      assert.equal((await source.token.balanceOf(source.wallet.address)).toString(),beforeSource.sub(amount).toString());
      assert.equal((await target.token.balanceOf(target.wallet.address)).toString(),beforeTarget.add(amount).toString());
      assert(await target.bridge.processed(id));
      await r.poll();
      assert.equal((await target.token.balanceOf(target.wallet.address)).toString(),beforeTarget.add(amount).toString());
      console.log(source.key+'→'+target.key+': automatic burn/mint, receipt and replay checks passed');
    }
    assert.equal(r.store.summary().counts.executed,2);
  } finally {
    for (const server of servers) await server.close();
    fs.rmSync(dir,{recursive:true,force:true});
  }
}
main().catch(e=>{console.error(e);process.exitCode=1});
