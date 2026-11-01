const fs = require('node:fs');
const path = require('node:path');

function now() {
  return new Date().toISOString();
}

class StateStore {
  constructor(file, networks) {
    this.file = file;
    this.networks = networks;
    this.data = this.load();
  }

  load() {
    if (!fs.existsSync(this.file)) {
      return this.emptyState();
    }

    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      return {
        version: 1,
        updatedAt: parsed.updatedAt || now(),
        networks: parsed.networks || {},
        messages: parsed.messages || {},
      };
    } catch (error) {
      throw new Error(`Unable to read relayer state ${this.file}: ${error.message}`);
    }
  }

  emptyState() {
    return {
      version: 1,
      updatedAt: now(),
      networks: {},
      messages: {},
    };
  }

  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    this.data.updatedAt = now();
    const tempFile = `${this.file}.tmp`;
    fs.writeFileSync(tempFile, `${JSON.stringify(this.data, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(tempFile, this.file);
  }

  network(key, startBlock) {
    if (!this.data.networks[key]) {
      this.data.networks[key] = {
        nextBlock: startBlock,
        lastScannedBlock: null,
        lastScanAt: null,
        lastError: null,
      };
      this.save();
    }
    return this.data.networks[key];
  }

  updateNetwork(key, patch) {
    this.data.networks[key] = { ...this.network(key, null), ...patch };
    this.save();
    return this.data.networks[key];
  }

  message(id) {
    return this.data.messages[id] || null;
  }

  upsertMessage(message) {
    const current = this.data.messages[message.messageId];
    if (!current) {
      this.data.messages[message.messageId] = message;
    } else {
      this.data.messages[message.messageId] = { ...current, ...message };
    }
    this.save();
    return this.data.messages[message.messageId];
  }

  updateMessage(id, patch) {
    const current = this.data.messages[id];
    if (!current) throw new Error(`Unknown relayer message ${id}`);
    this.data.messages[id] = { ...current, ...patch, updatedAt: now() };
    this.save();
    return this.data.messages[id];
  }

  messages(filter) {
    return Object.values(this.data.messages)
      .filter((message) => !filter || !filter.status || message.status === filter.status)
      .sort((a, b) => String(b.detectedAt).localeCompare(String(a.detectedAt)));
  }

  summary() {
    const messages = this.messages();
    const counts = messages.reduce((result, message) => {
      result[message.status] = (result[message.status] || 0) + 1;
      return result;
    }, {});
    return { total: messages.length, counts };
  }
}

module.exports = { StateStore, now };
