import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { Duplex } from 'node:stream';
import mqtt from 'mqtt';
import { BambuFleet } from '../server/bambu-fleet.mjs';

class FakeClient extends EventEmitter {
  sent = [];
  acknowledge = true;
  subscribe(topic, options, callback) {
    this.subscription = { topic, options, callback };
  }
  publish(topic, body, options, callback) {
    this.sent.push({ topic, payload: JSON.parse(body), options });
    if (this.acknowledge) callback?.();
  }
  async endAsync() {}
}

function fixture(options = {}) {
  const clients = [];
  const configs = ['FIRST', 'SECOND'].map((serial, index) => ({
    id: 'printer-' + index, name: serial, serial, ip: '192.168.1.' + (10 + index),
    accessCode: 'LOCAL-SECRET-' + index, caCertificate: Buffer.from('test-ca'),
  }));
  const fleet = new BambuFleet(configs, { ...options, connect: () => {
    const client = new FakeClient();
    clients.push(client);
    return client;
  } });
  return { fleet, clients };
}

function connect(client) {
  client.emit('connect');
  client.subscription.callback(null, [{ qos: 1 }]);
}

test('先订阅再请求状态，两台设备使用各自主题及序号', async () => {
  const { fleet, clients } = fixture();
  clients[0].emit('connect');
  assert.equal(clients[0].sent.length, 0);
  assert.equal(clients[0].subscription.topic, 'device/FIRST/report');
  clients[0].subscription.callback(null, [{ qos: 1 }]);
  connect(clients[1]);
  await fleet.command('printer-0', 'pause');
  const pause = clients[0].sent.find(message => message.payload.print?.command === 'pause');
  assert.equal(pause.topic, 'device/FIRST/request');
  assert.equal(pause.payload.print.sequence_id, '3');
  assert.equal(pause.options.qos, 1);
  assert.equal(clients[1].sent.length, 2);
  assert.equal(clients[1].sent[1].payload.info.command, 'get_version');
  assert.equal(clients[1].sent[0].payload.pushing.sequence_id, '1');
  assert.equal(JSON.stringify(fleet.getPrinters()).includes('LOCAL-SECRET'), false);
  await fleet.close();
});

test('忽略不匹配的状态主题，断线设备不发送控制', async () => {
  const { fleet, clients } = fixture();
  connect(clients[0]);
  const report = Buffer.from(JSON.stringify({ print: { gcode_state: 'RUNNING' } }));
  clients[0].emit('message', 'device/SECOND/report', report);
  assert.equal(fleet.getPrinters()[0].status, 'offline');
  clients[0].emit('message', 'device/FIRST/report', report);
  assert.equal(fleet.getPrinters()[0].status, 'printing');
  clients[0].emit('close');
  await assert.rejects(fleet.command('printer-0', 'stop'), (error) => error.statusCode === 409);
  assert.equal(clients[0].sent.length, 2);
  await fleet.close();
});

test('投递未确认时有限等待并返回状态未知', async () => {
  const { fleet, clients } = fixture({ commandTimeoutMs: 15 });
  connect(clients[0]);
  clients[0].acknowledge = false;
  await assert.rejects(fleet.command('printer-0', 'pause'), (error) => error.statusCode === 504 && error.message.includes('执行状态未知'));
  await fleet.close();
});

test('原任务已被替换或断线重连时，旧确认不能投递停止指令', async () => {
  const { fleet, clients: [client] } = fixture();
  const reportJob = (subtask_id) => client.emit('message', 'device/FIRST/report', Buffer.from(JSON.stringify({
    print: { gcode_state: 'RUNNING', subtask_name: 'same.gcode', subtask_id },
  })));
  connect(client);
  reportJob('101');
  const firstJob = fleet.getPrinters()[0].currentJob.id;
  reportJob('102');
  const secondJob = fleet.getPrinters()[0].currentJob.id;
  await assert.rejects(fleet.command('printer-0', 'stop', undefined, firstJob), { statusCode: 409 });

  client.emit('close');
  connect(client);
  reportJob('102');
  await assert.rejects(fleet.command('printer-0', 'stop', undefined, secondJob), { statusCode: 409 });
  assert.equal(client.sent.some(({ payload }) => payload.print?.command === 'stop'), false);
  await fleet.command('printer-0', 'stop', undefined, fleet.getPrinters()[0].currentJob.id);
  assert.equal(client.sent.filter(({ payload }) => payload.print?.command === 'stop').length, 1);
  await fleet.close();
});

test('未收到任务名称或设备任务 ID 时不投递停止指令', async () => {
  const { fleet, clients: [client] } = fixture();
  connect(client);
  client.emit('message', 'device/FIRST/report', Buffer.from(JSON.stringify({
    print: { gcode_state: 'RUNNING', subtask_id: '0', task_id: '0', mc_percent: 12 },
  })));
  assert.equal(fleet.getPrinters()[0].currentJob.id, null);
  await assert.rejects(fleet.command('printer-0', 'stop'), { statusCode: 409 });
  assert.equal(client.sent.some(({ payload }) => payload.print?.command === 'stop'), false);
  await fleet.close();
});

test('局域网重打同名文件时，只接受当前运行周期的停止确认', async () => {
  const { fleet, clients: [client] } = fixture();
  const reportJob = (gcode_state) => client.emit('message', 'device/FIRST/report', Buffer.from(JSON.stringify({
    print: { gcode_state, subtask_name: 'local.gcode', subtask_id: '0', task_id: '0' },
  })));
  connect(client);
  reportJob('RUNNING');
  const firstJob = fleet.getPrinters()[0].currentJob.id;
  assert.ok(firstJob);
  reportJob('PREPARE');
  await assert.rejects(fleet.command('printer-0', 'stop', undefined, firstJob), { statusCode: 409 });
  reportJob('RUNNING');
  await assert.rejects(fleet.command('printer-0', 'stop', undefined, firstJob), { statusCode: 409 });
  assert.equal(client.sent.some(({ payload }) => payload.print?.command === 'stop'), false);
  await fleet.command('printer-0', 'stop', undefined, fleet.getPrinters()[0].currentJob.id);
  assert.equal(client.sent.filter(({ payload }) => payload.print?.command === 'stop').length, 1);
  await fleet.close();
});

function mqttStreamFixture(onPublish) {
  const require = createRequire(import.meta.resolve('mqtt'));
  const { parser, generate } = require('mqtt-packet');
  const decode = parser();
  const stream = new Duplex({
    read() {},
    write(chunk, _encoding, done) {
      decode.parse(chunk);
      done();
    },
  });
  const respond = (packet) => queueMicrotask(() => {
    if (!stream.destroyed) stream.push(generate(packet));
  });
  decode.on('packet', (packet) => {
    if (packet.cmd === 'connect') respond({ cmd: 'connack', returnCode: 0, sessionPresent: false });
    if (packet.cmd === 'subscribe') respond({ cmd: 'suback', messageId: packet.messageId, granted: [1] });
    if (packet.cmd === 'publish' && onPublish(JSON.parse(packet.payload.toString()))) {
      respond({ cmd: 'puback', messageId: packet.messageId });
    }
  });
  return stream;
}

for (const failure of ['timeout', 'disconnect']) {
  test(`MQTT ${failure} 后取消未确认的控制指令，重连不会重发`, { timeout: 2000 }, async (t) => {
    const deliveries = [];
    const [firstReady, secondReady] = [Promise.withResolvers(), Promise.withResolvers()];
    const firstCommand = Promise.withResolvers();
    let connectionCount = 0;
    let stream;
    let client;
    const config = { id: 'one', name: 'ONE', serial: 'ONE', ip: '192.0.2.1', accessCode: 'fixture', caCertificate: Buffer.from('fixture') };
    const fleet = new BambuFleet([config], { commandTimeoutMs: 75, connect: (_, options) => {
      client = new mqtt.MqttClient(() => {
        const connection = ++connectionCount;
        stream = mqttStreamFixture((payload) => {
          if (payload.info?.command === 'get_version') (connection === 1 ? firstReady : secondReady).resolve();
          if (payload.print?.command !== 'pause') return true;
          deliveries.push(connection);
          if (connection !== 1) return true;
          firstCommand.resolve();
          return false;
        });
        return stream;
      }, { ...options, reconnectPeriod: 10 });
      return client;
    } });
    t.after(() => client.endAsync(true));
    await firstReady.promise;
    const command = fleet.command('one', 'pause');
    const rejection = assert.rejects(command, { statusCode: failure === 'timeout' ? 504 : 503 });
    await firstCommand.promise;
    if (failure === 'disconnect') stream.destroy();
    await rejection;
    assert.equal(fleet.getPrinters()[0].lastCommand.result, 'unknown');
    if (failure === 'timeout') stream.destroy();
    await secondReady.promise;
    assert.deepEqual(deliveries, [1]);
    await fleet.command('one', 'resume');
  });
}

test('设备拒绝响应只更新对应序号，且不伪造状态同步时间', async () => {
  const { fleet, clients } = fixture();
  connect(clients[0]);
  await fleet.command('printer-0', 'pause');
  const response = { print: { command: 'pause', sequence_id: '3', result: 'fail', reason: 'denied' } };
  clients[1].emit('message', 'device/FIRST/report', Buffer.from(JSON.stringify(response)));
  assert.equal(fleet.getPrinters()[0].lastCommand.result, 'sent');
  clients[0].emit('message', 'device/FIRST/report', Buffer.from(JSON.stringify(response)));
  assert.equal(fleet.getPrinters()[0].lastCommand.result, 'rejected');
  assert.equal(fleet.getPrinters()[0].lastCommand.reason, 'denied');
  assert.equal(fleet.getPrinters()[0].lastUpdated, null);
  assert.equal(fleet.getPrinters()[1].lastCommand, null);
  await fleet.close();
});

test('拒绝两个内部 ID 指向相同的物理设备', () => {
  const base = { name: '测试', serial: 'SAME', ip: '192.0.2.10', accessCode: 'secret' };
  assert.throws(() => new BambuFleet([{ ...base, id: 'a' }, { ...base, id: 'b' }]), /重复/);
  assert.throws(() => new BambuFleet([{ ...base, id: 'a' }, { ...base, id: 'b', serial: 'OTHER' }]), /重复/);
});

test('两台打印机的同号AMS单元仍按各自MQTT连接隔离', async () => {
  const { fleet, clients } = fixture();
  connect(clients[0]); connect(clients[1]);
  const send = (index, body) => clients[index].emit('message', 'device/' + (index === 0 ? 'FIRST' : 'SECOND') + '/report', Buffer.from(JSON.stringify(body)));
  send(0, { info: { command: 'get_version', module: [{ name: 'n3f/0', sn: 'H2S-AMS' }] } });
  send(1, { info: { command: 'get_version', module: [{ name: 'n3f/0', sn: 'A1-AMS' }] } });
  send(0, { print: { ams: { ams_exist_bits: '1', ams: [{ id: '0', info: '3', temp: '42.7', humidity_raw: '36' }] } } });
  send(1, { print: { ams: { ams_exist_bits: '1', ams: [{ id: '0', info: '3', temp: '25.2', humidity_raw: '55' }] } } });
  const printers = fleet.getPrinters();
  assert.equal(printers[0].ams[0].serial, 'H2S-AMS');
  assert.equal(printers[1].ams[0].serial, 'A1-AMS');
  assert.equal(printers[0].ams[0].temperature, 42.7);
  assert.equal(printers[1].ams[0].temperature, 25.2);
  await fleet.close();
});

test('AMS重新出现时只触发一次模块身份查询，不定时全量轮询', async () => {
  const { fleet, clients } = fixture();
  connect(clients[0]);
  for (const mask of ['1', '0', '1', '1']) clients[0].emit('message', 'device/FIRST/report', Buffer.from(JSON.stringify({ print: { ams: { ams_exist_bits: mask } } })));
  assert.equal(clients[0].sent.filter(message => message.payload.info?.command === 'get_version').length, 2);
  assert.equal(clients[0].sent.filter(message => message.payload.pushing?.command === 'pushall').length, 1);
  await fleet.close();
});
