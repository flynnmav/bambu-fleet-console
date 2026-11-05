import test from 'node:test';
import assert from 'node:assert/strict';
import { createCommand, emptyPrinter, normalizeReport } from '../server/protocol.mjs';

const config = { id: 'one', name: '测试机', model: 'X1C', serial: 'SERIAL', ip: '192.168.1.2' };

test('暂停、继续和停止命令使用独立序列号及打印主题载荷', () => {
  for (const command of ['pause', 'resume', 'stop']) {
    const payload = createCommand(command);
    assert.equal(payload.print.command, command);
    assert.equal(payload.print.param, '');
    assert.ok(payload.print.sequence_id);
    assert.equal(createCommand(command, undefined, 7).print.sequence_id, '7');
  }
});

test('速度命令只接受四个预定义档位', () => {
  assert.deepEqual(createCommand('speed', 3).print.param, '3');
  assert.throws(() => createCommand('speed', 9), /不支持的打印速度/);
});

test('腔灯命令检查值类型', () => {
  assert.equal(createCommand('light', true).system.led_mode, 'on');
  assert.equal(createCommand('light', false).system.led_mode, 'off');
  assert.throws(() => createCommand('light', 'on'), /布尔值/);
});

test('状态报文映射打印进度、层数与温度', () => {
  const state = normalizeReport(emptyPrinter(config), {
    print: {
      gcode_state: 'RUNNING', subtask_name: '测试任务', mc_percent: 42,
      layer_num: 20, total_layer_num: 50, mc_remaining_time: 33,
      nozzle_temper: 215.4, nozzle_target_temper: 220,
      bed_temper: 54.8, bed_target_temper: 55, chamber_temper: 35,
      spd_lvl: 2, cooling_fan_speed: '80',
    },
  });
  assert.equal(state.status, 'printing');
  assert.equal(state.currentJob.name, '测试任务');
  assert.equal(state.currentJob.progress, 42);
  assert.equal(state.currentJob.layerTotal, 50);
  assert.equal(state.temperatures.nozzleTarget, 220);
  assert.equal(state.fans.partCooling, 80);
});

test('缺失字段保留上一次状态而不是重置', () => {
  const initial = normalizeReport(emptyPrinter(config), { print: { gcode_state: 'RUNNING', nozzle_temper: 200 } });
  const next = normalizeReport(initial, { print: { mc_percent: 10 } });
  assert.equal(next.temperatures.nozzle, 200);
  assert.equal(next.status, 'printing');
});

test('单独上报层数和剩余时间时仍更新任务', () => {
  const initial = normalizeReport(emptyPrinter(config), { print: { gcode_state: 'RUNNING', subtask_name: '任务 A', mc_percent: 20, layer_num: 10, mc_remaining_time: 50 } });
  const next = normalizeReport(initial, { print: { layer_num: 11, mc_remaining_time: 49, nozzle_temper: null } });
  assert.equal(next.currentJob.layerCurrent, 11);
  assert.equal(next.currentJob.remainingMinutes, 49);
  assert.equal(next.currentJob.progress, 20);
});

test('AMS 增量保留其他料盘及既有颜色材料', () => {
  const initial = normalizeReport(emptyPrinter(config), { print: { ams: { ams: [{ id: '0', humidity: '2', tray: [
    { id: '0', tray_type: 'PLA', tray_color: '112233FF', remain: 70 },
    { id: '1', tray_type: 'PETG', tray_color: 'AABBCCFF', remain: 80 },
  ] }] } } });
  const next = normalizeReport(initial, { print: { ams: { ams: [{ id: '0', tray: [{ id: '0', remain: 69 }] }] } } });
  assert.equal(next.ams[0].trays.length, 2);
  assert.equal(next.ams[0].humidity, '2');
  assert.equal(next.ams[0].trays[0].material, 'PLA');
  assert.equal(next.ams[0].trays[0].color, '#112233');
  assert.equal(next.ams[0].trays[0].remaining, 69);
  assert.equal(initial.ams[0].trays[0].remaining, 70);
});

test('更换任务不复用上个任务进度，回到空闲清除任务', () => {
  const initial = normalizeReport(emptyPrinter(config), { print: { gcode_state: 'RUNNING', subtask_name: 'A', mc_percent: 90 } });
  const changed = normalizeReport(initial, { print: { subtask_name: 'B' } });
  assert.equal(changed.currentJob.progress, 0);
  const idle = normalizeReport(changed, { print: { gcode_state: 'IDLE' } });
  assert.equal(idle.currentJob, null);
  assert.equal(idle.lastJob, 'B');
});

test('保留打印失败错误码供界面展示', () => {
  const state = normalizeReport(emptyPrinter(config), { print: { gcode_state: 'FAILED', print_error: 123 } });
  assert.equal(state.status, 'error');
  assert.equal(state.errorCode, 123);
});
