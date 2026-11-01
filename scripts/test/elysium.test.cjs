const test = require('node:test');
const assert = require('node:assert/strict');
const {validateChain} = require('../elysium-deploy.cjs');
test('deployment rejects mainnets and old project networks before signing', () => {
  for (const chain of [1,999,998,91342,47805,1338,1339]) assert.throws(()=>validateChain(chain));
  assert.doesNotThrow(()=>validateChain(99801));
});
test('Elysium configuration uses HYPE and the HyperEVM testnet parent', () => {
  const net = require('../../networks/elysium-testnet.json');
  assert.equal(net.nativeCurrency.symbol,'HYPE');assert.equal(net.parentChainId,998);assert.equal(net.testnet,true);
});
test('operator test oracle scales exact prices without floating-point loss',()=>{
  const {scale}=require('../elysium-oracle.cjs');
  assert.equal(scale('3512345678',-8),3512345678n*10n**10n);
  assert.throws(()=>scale('1',-19));
});
