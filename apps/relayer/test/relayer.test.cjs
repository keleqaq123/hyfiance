const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {ethers} = require('ethers');
const {BridgeRelayer} = require('../src/relayer.cjs');
const {StateStore} = require('../src/state.cjs');

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'custos-relayer-test-'));
  t.after(() => fs.rmSync(dir, {recursive:true, force:true}));
  const r = Object.create(BridgeRelayer.prototype);
  r.config = {receiptConfirmations:2, pendingTxTimeoutMs:10000, gasLimitMultiplierBps:12500, retryBaseMs:5000, retryMaxMs:300000};
  r.store = new StateStore(path.join(dir, 'state.json'), []);
  r.log = () => {};
  r.processing = new Set();
  const target = {name:'test', provider:{}, contract:{}};
  r.networks = new Map([['B',target]]);
  const message = {messageId:'0x123', status:'pending', targetNetwork:'B', attempts:0, detectedAt:new Date().toISOString()};
  r.store.upsertMessage(message);
  return {r,target,message};
}

test('persists submission and resumes without duplicate execution', async t => {
  const {r,target,message} = fixture(t);
  let submissions = 0;
  target.contract.processed = async () => false;
  target.contract.estimateGas = {executeMessage:async () => ethers.BigNumber.from(100000)};
  target.contract.executeMessage = async (...args) => {
    submissions++;
    assert.equal(args.at(-1).gasLimit.toString(), '125000');
    return {hash:'0xtx'};
  };
  await r.processPendingMessages();
  assert.equal(r.store.message(message.messageId).status, 'submitted');
  const reopened = new StateStore(r.store.file, []);
  assert.equal(reopened.message(message.messageId).executeTxHash, '0xtx');
  target.provider.getTransactionReceipt = async () => null;
  target.provider.getTransaction = async () => ({hash:'0xtx'});
  await r.processPendingMessages();
  assert.equal(submissions, 1);
  target.provider.getTransactionReceipt = async () => ({status:1, confirmations:1, transactionHash:'0xtx', blockNumber:10});
  await r.processPendingMessages();
  assert.equal(r.store.message(message.messageId).status, 'submitted');
  target.provider.getTransactionReceipt = async () => ({status:1, confirmations:2, transactionHash:'0xtx', blockNumber:10});
  await r.processPendingMessages();
  assert.equal(r.store.message(message.messageId).status, 'executed');
  assert.equal(submissions, 1);
});

test('preserves submitted hash during receipt RPC failure, then recovers', async t => {
  const {r,target,message} = fixture(t);
  r.store.updateMessage(message.messageId, {status:'submitted', executeTxHash:'0xtx'});
  target.provider.getTransactionReceipt = async () => {throw Error('RPC unavailable')};
  await r.processPendingMessages();
  assert.equal(r.store.message(message.messageId).executeTxHash, '0xtx');
  assert.equal(r.store.message(message.messageId).status, 'submitted');
  assert.equal(r.processing.size, 0);
  target.provider.getTransactionReceipt = async () => ({status:1, confirmations:2, transactionHash:'0xtx'});
  await r.processPendingMessages();
  assert.equal(r.store.message(message.messageId).status, 'executed');
});

test('backs off failures and honors onchain replay protection', async t => {
  const {r,target,message} = fixture(t);
  target.contract.processed = async () => {throw Error('RPC unavailable')};
  await r.processPendingMessages();
  const retry = r.store.message(message.messageId);
  assert.equal(retry.status, 'retry');
  assert.equal(retry.attempts, 1);
  assert(retry.nextAttemptAt > Date.now());
  target.contract.processed = async () => true;
  r.store.updateMessage(message.messageId, {nextAttemptAt:0});
  await r.processPendingMessages();
  assert.equal(r.store.message(message.messageId).status, 'executed');
  assert.equal(r.store.message(message.messageId).alreadyProcessed, true);
});
