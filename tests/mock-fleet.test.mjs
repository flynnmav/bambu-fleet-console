import test from 'node:test';
import assert from 'node:assert/strict';
import { MockFleet } from '../server/mock-fleet.mjs';

test('演示服务验证未知命令和参数', async () => {
  const fleet = new MockFleet();
  await assert.rejects(fleet.command('h2s', 'unknown'), /不支持的控制命令/);
  await assert.rejects(fleet.command('h2s', 'light', 'on'), /布尔值/);
});

test('演示服务可以暂停并继续第一台设备而不影响第二台', async () => {
  const fleet = new MockFleet();
  await fleet.command('h2s', 'pause');
  await fleet.command('h2s', 'resume');
  const printers = fleet.getPrinters();
  assert.equal(printers[0].status, 'printing');
  assert.equal(printers[1].status, 'idle');
});

test('演示停止会清空当前任务并保留上一任务名称', async () => {
  const fleet = new MockFleet();
  await fleet.command('h2s', 'stop');
  const printer = fleet.getPrinters()[0];
  assert.equal(printer.status, 'idle');
  assert.equal(printer.currentJob, null);
  assert.equal(printer.lastJob, '齿轮传动盒_v12.gcode');
});

test('演示步进更新温度并在订阅中通知监听者', async () => {
  const fleet = new MockFleet();
  let notified = 0;
  const unsubscribe = fleet.subscribe(() => { notified += 1; });
  for (let i = 0; i < 4; i++) fleet.step();
  const printer = fleet.getPrinters()[0];
  assert.equal(notified, 4);
  assert.equal(printer.currentJob.progress, 69);
  unsubscribe();
  await fleet.close();
});
