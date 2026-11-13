import mqtt from 'mqtt';
import { createCommand, emptyPrinter, normalizeReport } from './protocol.mjs';

class BambuConnection {
  constructor(config, { connect = mqtt.connect, commandTimeoutMs = 8000, onUpdate } = {}) {
    this.commandTimeoutMs = commandTimeoutMs;
    this.onUpdate = onUpdate;
    this.config = config;
    this.state = emptyPrinter(config);
    this.sequenceId = 0;
    this.pendingCommands = new Map();
    this.client = connect(`mqtts://${config.ip}:8883`, {
      username: 'bblp',
      password: config.accessCode,
      clientId: `fleet-console-${config.serial}-${Math.random().toString(16).slice(2, 8)}`,
      protocolVersion: 4,
      ...(config.caCertificate
        ? { ca: config.caCertificate, rejectUnauthorized: true, servername: config.serial }
        : { rejectUnauthorized: false }),
      connectTimeout: 6000,
      reconnectPeriod: 5000,
    });
    if (!config.caCertificate) console.warn(`[${config.name}] 未配置 BBL CA，当前仅加密传输但未完整校验设备证书`);
    this.client.on('connect', () => {
      this.client.subscribe(`device/${config.serial}/report`, { qos: 1 }, (error, granted) => {
        if (error || granted?.some((item) => item.qos === 128)) {
          console.warn(`[${config.name}] 状态主题订阅失败`);
          this.state.connected = false;
          this.state.status = 'offline';
          this.notify();
          return;
        }
        this.state.connected = true;
        this.requestStatus();
        this.notify();
      });
    });
    this.client.on('message', (topic, payload) => {
      if (topic !== `device/${config.serial}/report`) return;
      try {
        const report = JSON.parse(payload.toString());
        const previousPresence = this.state.amsState?.existBits;
        this.state = normalizeReport(this.state, report, { amsModels: config.amsModels });
        const presence = this.state.amsState?.existBits;
        if (previousPresence != null && presence != null && presence !== previousPresence) {
          try {
            const prevBits = BigInt('0x' + (previousPresence || '0'));
            const nextBits = BigInt('0x' + (presence || '0'));
            if ((nextBits & ~prevBits) !== 0n) this.requestVersions();
          } catch {
            if (presence !== '0') this.requestVersions();
          }
        }
        const response = [report?.print, report?.system].find((item) => {
          if (item?.result == null || item?.sequence_id == null) return false;
          const tracked = this.pendingCommands.get(String(item.sequence_id));
          return Boolean(tracked && (!item.command || item.command === tracked.command));
        });
        if (response) {
          const seqId = String(response.sequence_id);
          const tracked = this.pendingCommands.get(seqId);
          const updated = {
            ...tracked,
            result: String(response.result).toLowerCase() === 'success' ? 'acknowledged' : 'rejected',
            reason: response.reason == null ? String(response.result) : String(response.reason),
          };
          this.pendingCommands.set(seqId, updated);
          if (updated.result === 'rejected' || this.state.lastCommand?.sequenceId === seqId) {
            this.state.lastCommand = updated;
          }
        }
        this.state.connected = true;
        this.notify();
      } catch {
        console.warn(`[${config.name}] 收到无法解析的状态报文`);
      }
    });
    this.client.on('close', () => {
      this.state.connected = false;
      this.state.status = 'offline';
      this.notify();
    });
    this.client.on('error', (error) => {
      console.warn(`[${config.name}] MQTT 连接异常：${error.message}`);
    });
  }

  notify() {
    this.onUpdate?.(this.state);
  }

  recordCommand(sequenceId, entry) {
    this.pendingCommands.set(sequenceId, entry);
    if (this.pendingCommands.size > 32) {
      const oldestKey = this.pendingCommands.keys().next().value;
      if (oldestKey !== undefined) this.pendingCommands.delete(oldestKey);
    }
  }

  requestStatus() {
    this.client.publish(
      `device/${this.config.serial}/request`,
      JSON.stringify({ pushing: { command: 'pushall', sequence_id: String(++this.sequenceId), version: 1, push_target: 1 } }),
      { qos: 1 },
    );
    this.requestVersions();
  }

  requestVersions() {
    this.client.publish(
      `device/${this.config.serial}/request`,
      JSON.stringify({ info: { command: 'get_version', sequence_id: String(++this.sequenceId) } }),
      { qos: 1 },
    );
  }

  async command(command, value) {
    if (!this.state.connected) {
      const error = new Error('打印机当前不在线，指令未发送');
      error.statusCode = 409;
      throw error;
    }
    const payload = createCommand(command, value, ++this.sequenceId);
    const envelope = payload.print || payload.system;
    const sequenceId = envelope.sequence_id;
    const initialEntry = { sequenceId, command: envelope.command, result: 'sending', reason: '正在投递' };
    this.recordCommand(sequenceId, initialEntry);
    this.state.lastCommand = initialEntry;
    try {
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          const error = new Error('指令投递超时，执行状态未知，请核对设备状态后再操作');
          error.statusCode = 504;
          reject(error);
        }, this.commandTimeoutMs);
        this.client.publish(
          `device/${this.config.serial}/request`,
          JSON.stringify(payload),
          { qos: 1 },
          (error) => {
            clearTimeout(timeout);
            error ? reject(error) : resolve();
          },
        );
      });
      const current = this.pendingCommands.get(sequenceId);
      if (current?.result === 'sending') {
        const sentEntry = { ...current, result: 'sent', reason: '已投递，等待设备状态或响应' };
        this.recordCommand(sequenceId, sentEntry);
        if (this.state.lastCommand?.sequenceId === sequenceId && this.state.lastCommand.result === 'sending') {
          this.state.lastCommand = sentEntry;
        }
      }
      this.notify();
    } catch (error) {
      const current = this.pendingCommands.get(sequenceId);
      if (current?.result === 'sending') {
        const unknownEntry = { ...current, result: 'unknown', reason: error.message };
        this.recordCommand(sequenceId, unknownEntry);
        if (this.state.lastCommand?.sequenceId === sequenceId && this.state.lastCommand.result === 'sending') {
          this.state.lastCommand = unknownEntry;
        }
      }
      this.notify();
      throw error;
    }
    return this.state;
  }

  async close() {
    let timer;
    await Promise.race([
      Promise.resolve(this.client.endAsync(true)).catch(() => {}),
      new Promise((resolve) => {
        timer = setTimeout(resolve, 2000);
        timer.unref?.();
      }),
    ]);
    clearTimeout(timer);
  }
}

export class BambuFleet {
  constructor(configs, options = {}) {
    this.listeners = new Set();
    const ids = new Set();
    const serials = new Set();
    const endpoints = new Set();
    for (const config of configs) {
      if (!/^[a-zA-Z0-9_-]+$/.test(config.id || '')) throw new Error('打印机 id 只能包含字母、数字、下划线和连字符');
      if (ids.has(config.id)) throw new Error(`重复的打印机 id：${config.id}`);
      ids.add(config.id);
      if (serials.has(config.serial) || endpoints.has(config.ip)) throw new Error(`打印机 ${config.id} 的序列号或 IP 与另一台设备重复，请检查配置`);
      serials.add(config.serial);
      endpoints.add(config.ip);
      for (const key of ['name', 'ip', 'serial', 'accessCode']) {
        if (!config[key]) throw new Error(`打印机 ${config.id} 缺少 ${key}`);
      }
    }
    this.connections = configs.map((config) => new BambuConnection(config, {
      ...options,
      onUpdate: () => this.emit(),
    }));
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit() {
    const printers = this.getPrinters();
    for (const listener of this.listeners) {
      try {
        listener(printers);
      } catch {
        // ignore listener errors
      }
    }
  }

  getPrinters() {
    return this.connections.map((connection) => connection.state);
  }

  async command(id, command, value) {
    const connection = this.connections.find((item) => item.config.id === id);
    if (!connection) {
      const error = new Error('未找到打印机');
      error.statusCode = 404;
      throw error;
    }
    createCommand(command, value);
    return connection.command(command, value);
  }

  async close() {
    await Promise.allSettled(this.connections.map((connection) => connection.close()));
  }
}
