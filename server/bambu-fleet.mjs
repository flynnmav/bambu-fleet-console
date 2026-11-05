import mqtt from 'mqtt';
import { createCommand, emptyPrinter, normalizeReport } from './protocol.mjs';

class BambuConnection {
  constructor(config, { connect = mqtt.connect, commandTimeoutMs = 8000 } = {}) {
    this.commandTimeoutMs = commandTimeoutMs;
    this.config = config;
    this.state = emptyPrinter(config);
    this.sequenceId = 0;
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
      this.state.connected = true;
      this.client.subscribe(`device/${config.serial}/report`, { qos: 1 }, (error, granted) => {
        if (error || granted?.some((item) => item.qos === 128)) {
          console.warn(`[${config.name}] 状态主题订阅失败`);
          this.state.connected = false;
          this.state.status = 'offline';
          return;
        }
        this.requestStatus();
      });
    });
    this.client.on('message', (topic, payload) => {
      if (topic !== `device/${config.serial}/report`) return;
      try {
        const report = JSON.parse(payload.toString());
        this.state = normalizeReport(this.state, report);
        const pending = this.state.lastCommand;
        const response = [report?.print, report?.system].find((item) => item?.result != null && pending && String(item.sequence_id) === pending.sequenceId && item.command === pending.command);
        if (response) {
          this.state.lastCommand = {
            ...pending,
            result: String(response.result).toLowerCase() === 'success' ? 'acknowledged' : 'rejected',
            reason: response.reason == null ? String(response.result) : String(response.reason),
          };
        }
        this.state.connected = true;
      } catch {
        console.warn(`[${config.name}] 收到无法解析的状态报文`);
      }
    });
    this.client.on('close', () => {
      this.state.connected = false;
      this.state.status = 'offline';
    });
    this.client.on('error', (error) => {
      console.warn(`[${config.name}] MQTT 连接异常：${error.message}`);
    });
  }

  requestStatus() {
    this.client.publish(
      `device/${this.config.serial}/request`,
      JSON.stringify({ pushing: { command: 'pushall', sequence_id: String(++this.sequenceId), version: 1, push_target: 1 } }),
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
    this.state.lastCommand = { sequenceId, command: envelope.command, result: 'sending', reason: '正在投递' };
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
      if (this.state.lastCommand?.sequenceId === sequenceId && this.state.lastCommand.result === 'sending') {
        this.state.lastCommand = { ...this.state.lastCommand, result: 'sent', reason: '已投递，等待设备状态或响应' };
      }
    } catch (error) {
      if (this.state.lastCommand?.sequenceId === sequenceId && this.state.lastCommand.result === 'sending') {
        this.state.lastCommand = { ...this.state.lastCommand, result: 'unknown', reason: error.message };
      }
      throw error;
    }
    return this.state;
  }

  async close() {
    await this.client.endAsync();
  }
}

export class BambuFleet {
  constructor(configs, options = {}) {
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
    this.connections = configs.map((config) => new BambuConnection(config, options));
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
