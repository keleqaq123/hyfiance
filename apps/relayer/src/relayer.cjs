const http = require('node:http');
const { ethers } = require('ethers');
const { StateStore, now } = require('./state.cjs');

const BRIDGE_ABI = [
  'function isRelayer(address account) view returns (bool)',
  'function processed(bytes32 messageId) view returns (bool)',
  'function executeMessage(bytes32 messageId,uint256 sourceChainId,address sourceBridge,address sourceToken,address recipient,uint256 amount,uint256 nonce,bytes payload)',
  'event MessageSent(bytes32 indexed messageId,uint256 indexed sourceChainId,uint256 indexed targetChainId,address sourceBridge,address targetBridge,address sourceToken,address targetToken,address sender,address recipient,uint256 amount,bytes payload,uint256 nonce)',
];

const BRIDGE_INTERFACE = new ethers.utils.Interface(BRIDGE_ABI);
const MESSAGE_SENT_TOPIC = BRIDGE_INTERFACE.getEventTopic('MessageSent');

function address(value) {
  return ethers.utils.getAddress(value);
}

function lower(value) {
  return String(value).toLowerCase();
}

function errorText(error) {
  return String(error?.reason || error?.error?.message || error?.message || error).slice(0, 1000);
}

class BridgeRelayer {
  constructor(config) {
    this.config = config;
    this.store = new StateStore(config.stateFile, config.networks);
    this.walletAddress = new ethers.Wallet(config.privateKey).address;
    this.networks = new Map();
    this.byChainId = new Map();
    this.processing = new Set();
    this.polling = false;
    this.timer = null;
    this.httpServer = null;

    for (const networkConfig of config.networks) {
      const provider = new ethers.providers.JsonRpcProvider(networkConfig.rpc, {
        name: networkConfig.name,
        chainId: networkConfig.chainId,
      });
      const wallet = new ethers.Wallet(config.privateKey, provider);
      const bridge = new ethers.Contract(address(networkConfig.bridge), BRIDGE_ABI, wallet);
      const network = {
        ...networkConfig,
        bridge: address(networkConfig.bridge),
        bridgeToken: networkConfig.bridgeToken ? address(networkConfig.bridgeToken) : null,
        provider,
        wallet,
        contract: bridge,
        latestBlock: null,
        finalizedBlock: null,
      };
      this.networks.set(network.key, network);
      this.byChainId.set(network.chainId, network);
    }
  }

  log(level, message, extra = {}) {
    console.log(JSON.stringify({ at: now(), level, message, ...extra }));
  }

  async start() {
    if (this.networks.size !== 2) throw new Error('The relayer requires exactly two configured networks');
    for (const network of this.networks.values()) await this.validateNetwork(network);
    this.startHttpServer();
    this.log('info', 'bridge relayer started', {
      wallet: this.walletAddress,
      networks: [...this.networks.values()].map((network) => ({ key: network.key, name: network.name, chainId: network.chainId })),
      stateFile: this.config.stateFile,
    });

    await this.poll();
    this.timer = setInterval(() => void this.poll(), this.config.pollIntervalMs);
  }

  async stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.httpServer) await new Promise((resolve) => this.httpServer.close(resolve));
    this.httpServer = null;
    this.log('info', 'bridge relayer stopped');
  }

  async validateNetwork(network) {
    const actual = await network.provider.getNetwork();
    if (Number(actual.chainId) !== network.chainId) {
      throw new Error(`${network.name} returned chain ${actual.chainId}, expected ${network.chainId}`);
    }
    const authorized = await network.contract.isRelayer(this.walletAddress);
    if (!authorized) {
      throw new Error(`${this.walletAddress} is not an authorized relayer on ${network.name} (${network.bridge})`);
    }
    network.latestBlock = await network.provider.getBlockNumber();
    network.finalizedBlock = Math.max(0, network.latestBlock - this.config.confirmations);
    this.log('info', 'relayer network ready', {
      network: network.name,
      chainId: network.chainId,
      bridge: network.bridge,
      wallet: this.walletAddress,
      latestBlock: network.latestBlock,
    });
  }

  async poll() {
    if (this.polling) return;
    this.polling = true;
    try {
      for (const network of this.networks.values()) {
        try {
          await this.scanNetwork(network);
        } catch (error) {
          this.store.updateNetwork(network.key, { lastError: errorText(error), lastScanAt: now() });
          this.log('error', 'network scan failed', { network: network.name, error: errorText(error) });
        }
      }
      await this.processPendingMessages();
    } finally {
      this.polling = false;
    }
  }

  async scanNetwork(network) {
    const latestBlock = await network.provider.getBlockNumber();
    const finalizedBlock = latestBlock - this.config.confirmations;
    network.latestBlock = latestBlock;
    network.finalizedBlock = finalizedBlock;
    if (finalizedBlock < 0) return;

    const persisted = this.store.network(network.key, network.startBlock);
    let cursor = persisted.nextBlock;
    if (cursor === null || cursor === undefined) {
      cursor = network.startBlock === null || network.startBlock === undefined ? finalizedBlock : network.startBlock;
      this.store.updateNetwork(network.key, { nextBlock: cursor });
    }
    if (cursor > finalizedBlock) {
      this.store.updateNetwork(network.key, { lastScannedBlock: finalizedBlock, lastScanAt: now(), lastError: null });
      return;
    }

    while (cursor <= finalizedBlock) {
      const toBlock = Math.min(cursor + this.config.maxLogBlockRange - 1, finalizedBlock);
      const logs = await network.provider.getLogs({
        address: network.bridge,
        topics: [MESSAGE_SENT_TOPIC],
        fromBlock: cursor,
        toBlock,
      });
      for (const log of logs) await this.recordMessage(network, log);
      cursor = toBlock + 1;
      this.store.updateNetwork(network.key, {
        nextBlock: cursor,
        lastScannedBlock: toBlock,
        lastScanAt: now(),
        lastError: null,
      });
    }
  }

  async recordMessage(source, log) {
    const parsed = BRIDGE_INTERFACE.parseLog(log);
    if (parsed.name !== 'MessageSent') return;
    const args = parsed.args;
    const target = this.byChainId.get(Number(args.targetChainId));
    if (!target) {
      this.log('warn', 'ignoring message for an unconfigured target chain', {
        source: source.name,
        targetChainId: Number(args.targetChainId),
        messageId: args.messageId,
        sourceTxHash: log.transactionHash,
      });
      return;
    }

    if (lower(args.sourceBridge) !== lower(source.bridge) || lower(args.targetBridge) !== lower(target.bridge)) {
      this.log('warn', 'ignoring message with an untrusted bridge pair', {
        messageId: args.messageId,
        sourceTxHash: log.transactionHash,
      });
      return;
    }

    const messageId = lower(args.messageId);
    if (this.store.message(messageId)) return;
    const message = {
      messageId,
      status: 'pending',
      sourceNetwork: source.key,
      targetNetwork: target.key,
      sourceChainId: Number(args.sourceChainId),
      targetChainId: Number(args.targetChainId),
      sourceBridge: address(args.sourceBridge),
      targetBridge: address(args.targetBridge),
      sourceToken: address(args.sourceToken),
      targetToken: address(args.targetToken),
      sender: address(args.sender),
      recipient: address(args.recipient),
      amount: args.amount.toString(),
      nonce: args.nonce.toString(),
      payload: args.payload,
      sourceTxHash: log.transactionHash,
      sourceBlockNumber: log.blockNumber,
      attempts: 0,
      nextAttemptAt: 0,
      detectedAt: now(),
      updatedAt: now(),
    };
    this.store.upsertMessage(message);
    this.log('info', 'message detected', {
      messageId,
      source: source.name,
      target: target.name,
      sourceTxHash: log.transactionHash,
      amount: message.amount,
    });
  }

  async processPendingMessages() {
    const due = this.store
      .messages()
      .filter((message) => ['pending', 'retry', 'submitted'].includes(message.status))
      .filter((message) => !message.nextAttemptAt || message.nextAttemptAt <= Date.now());
    for (const message of due) {
      if (this.processing.has(message.messageId)) continue;
      this.processing.add(message.messageId);
      try {
        await this.processMessage(message);
      } catch (error) {
        // Keep a submitted transaction's hash when receipt RPC calls fail.
        // Retrying a read must not turn into a duplicate submission.
        this.store.updateMessage(message.messageId, { lastError: errorText(error) });
        this.log('warn', 'message processing interrupted', { messageId: message.messageId, error: errorText(error) });
      } finally {
        this.processing.delete(message.messageId);
      }
    }
  }

  async processMessage(message) {
    const target = this.networks.get(message.targetNetwork);
    if (!target) return this.markRetry(message, new Error(`Target network ${message.targetNetwork} is not configured`));

    if (message.status === 'submitted' && message.executeTxHash) {
      const receipt = await target.provider.getTransactionReceipt(message.executeTxHash);
      if (!receipt) {
        const age = Date.now() - new Date(message.submittedAt || message.updatedAt).getTime();
        const pendingTransaction = await target.provider.getTransaction(message.executeTxHash);
        if (pendingTransaction || age < this.config.pendingTxTimeoutMs) return;
        return this.markRetry(message, new Error(`Pending execution transaction timed out: ${message.executeTxHash}`));
      }
      if (receipt.confirmations < this.config.receiptConfirmations) return;
      if (receipt.status === 1) return this.markExecuted(message, receipt, true);
      return this.markRetry(message, new Error(`Execution transaction failed: ${message.executeTxHash}`));
    }

    try {
      if (await target.contract.processed(message.messageId)) {
        this.store.updateMessage(message.messageId, { status: 'executed', alreadyProcessed: true, nextAttemptAt: 0 });
        this.log('info', 'message was already executed', { messageId: message.messageId });
        return;
      }

      const args = [
        message.messageId,
        message.sourceChainId,
        message.sourceBridge,
        message.sourceToken,
        message.recipient,
        message.amount,
        message.nonce,
        message.payload,
      ];
      const estimate = await target.contract.estimateGas.executeMessage(...args);
      const gasLimit = estimate.mul(this.config.gasLimitMultiplierBps).div(10000);
      const tx = await target.contract.executeMessage(...args, { gasLimit });
      this.store.updateMessage(message.messageId, {
        status: 'submitted',
        executeTxHash: tx.hash,
        submittedAt: now(),
        attempts: Number(message.attempts || 0) + 1,
        nextAttemptAt: 0,
        lastError: null,
      });
      this.log('info', 'destination execution submitted', {
        messageId: message.messageId,
        target: target.name,
        executeTxHash: tx.hash,
      });
      // Do not block the polling loop while a destination transaction is
      // pending. The next poll resumes it from the durable tx hash, which
      // keeps both chains observable even when one RPC is slow.
      return;
    } catch (error) {
      return this.markRetry(message, error);
    }
  }

  markExecuted(message, receipt, resumed) {
    this.store.updateMessage(message.messageId, {
      status: 'executed',
      targetTxHash: receipt.transactionHash,
      targetBlockNumber: receipt.blockNumber,
      executedAt: now(),
      nextAttemptAt: 0,
      lastError: null,
    });
    this.log('info', 'message executed', {
      messageId: message.messageId,
      targetTxHash: receipt.transactionHash,
      resumed,
    });
  }

  markRetry(message, error) {
    const attempts = Number(message.attempts || 0) + 1;
    const delay = Math.min(
      this.config.retryMaxMs,
      this.config.retryBaseMs * (2 ** Math.min(attempts - 1, 8)),
    );
    this.store.updateMessage(message.messageId, {
      status: 'retry',
      attempts,
      nextAttemptAt: Date.now() + delay,
      lastError: errorText(error),
      executeTxHash: null,
      submittedAt: null,
    });
    this.log('warn', 'message scheduled for retry', {
      messageId: message.messageId,
      attempts,
      retryInMs: delay,
      error: errorText(error),
    });
  }

  status() {
    return {
      ok: true,
      service: 'custos-bridge-relayer',
      wallet: this.walletAddress,
      deploymentFile: this.config.deploymentFile,
      pollIntervalMs: this.config.pollIntervalMs,
      confirmations: this.config.confirmations,
      networks: [...this.networks.values()].map((network) => {
        const state = this.store.network(network.key, network.startBlock);
        return {
          key: network.key,
          name: network.name,
          chainId: network.chainId,
          bridge: network.bridge,
          latestBlock: network.latestBlock,
          finalizedBlock: network.finalizedBlock,
          nextBlock: state.nextBlock,
          lastScannedBlock: state.lastScannedBlock,
          lastScanAt: state.lastScanAt,
          lastError: state.lastError,
        };
      }),
      messages: this.store.summary(),
    };
  }

  startHttpServer() {
    this.httpServer = http.createServer((request, response) => {
      const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
      response.setHeader('Content-Type', 'application/json; charset=utf-8');
      response.setHeader('Access-Control-Allow-Origin', '*');

      if (request.method === 'GET' && url.pathname === '/health') {
        response.writeHead(200);
        response.end(JSON.stringify(this.status()));
        return;
      }

      if (request.method === 'GET' && url.pathname === '/messages') {
        const status = url.searchParams.get('status') || undefined;
        const limit = Math.min(Number(url.searchParams.get('limit') || 100), 1000);
        response.writeHead(200);
        response.end(JSON.stringify({ messages: this.store.messages({ status }).slice(0, limit) }));
        return;
      }

      if (request.method === 'GET' && url.pathname.startsWith('/messages/')) {
        const id = url.pathname.slice('/messages/'.length).toLowerCase();
        const message = this.store.message(id);
        response.writeHead(message ? 200 : 404);
        response.end(JSON.stringify(message || { error: 'message_not_found' }));
        return;
      }

      response.writeHead(404);
      response.end(JSON.stringify({ error: 'not_found' }));
    });
    this.httpServer.listen(this.config.http.port, this.config.http.host, () => {
      this.log('info', 'relayer health API listening', {
        address: `${this.config.http.host}:${this.config.http.port}`,
      });
    });
  }
}

module.exports = { BridgeRelayer, BRIDGE_ABI, MESSAGE_SENT_TOPIC };
