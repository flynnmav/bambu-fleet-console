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
      spd_lvl: 2, cooling_fan_speed: '12',
    },
  });
  assert.equal(state.status, 'printing');
  assert.equal(state.currentJob.name, '测试任务');
  assert.equal(state.currentJob.progress, 42);
  assert.equal(state.currentJob.layerTotal, 50);
  assert.equal(state.temperatures.nozzleTarget, 220);
  assert.equal(state.fans.partCooling, 80);
});

test('风扇按旧协议缩放，fan_gear 按字节解码并优先于旧字段', () => {
  const initial = normalizeReport(emptyPrinter(config), { print: { cooling_fan_speed: '15', big_fan1_speed: '6' } });
  assert.deepEqual(initial.fans, { partCooling: 100, auxiliary: 40, chamber: 0 });
  const packed = normalizeReport(initial, { print: { fan_gear: 0xff0080, cooling_fan_speed: '15' } });
  assert.deepEqual(packed.fans, { partCooling: 50, auxiliary: 0, chamber: 100 });
  const delta = normalizeReport(packed, { print: { cooling_fan_speed: '0' } });
  assert.deepEqual(delta.fans, { partCooling: 0, auxiliary: 0, chamber: 100 });
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
  const delayedProgress = normalizeReport(idle, { print: { mc_percent: 100 } });
  assert.equal(delayedProgress.currentJob, null);
  assert.equal(delayedProgress.lastJob, 'B');
});

for (const key of ['subtask_id', 'task_id', 'lan_task_id']) {
  test(`同名打印的 ${key} 改变时重置进度，普通增量保留任务身份`, () => {
    const first = normalizeReport(emptyPrinter(config), { print: {
      gcode_state: 'RUNNING', subtask_name: 'same.gcode', [key]: '101', mc_percent: 87,
      layer_num: 42, total_layer_num: 48, mc_remaining_time: 4,
    } });
    const same = normalizeReport(first, { print: { layer_num: 43 } });
    assert.equal(same.currentJob.id, first.currentJob.id);
    assert.equal(same.currentJob.progress, 87);
    const next = normalizeReport(same, { print: { subtask_name: 'same.gcode', [key]: '102' } });
    assert.notEqual(next.currentJob.id, first.currentJob.id);
    assert.equal(next.currentJob.name, 'same.gcode');
    assert.equal(next.currentJob.progress, 0);
    assert.equal(next.currentJob.layerCurrent, 0);
    assert.equal(next.currentJob.layerTotal, 0);
    assert.equal(next.currentJob.remainingMinutes, 0);
  });
}

test('同名局域网任务进入 PREPARE 时清除上一任务进度', () => {
  const running = normalizeReport(emptyPrinter(config), { print: {
    gcode_state: 'RUNNING', gcode_file: 'local.gcode', task_id: '0', subtask_id: '0', mc_percent: 92,
  } });
  const prepare = normalizeReport(running, { print: { gcode_state: 'PREPARE', gcode_file: 'local.gcode' } });
  const next = normalizeReport(prepare, { print: { gcode_state: 'RUNNING' } });
  assert.equal(next.currentJob.name, 'local.gcode');
  assert.equal(next.currentJob.progress, 0);
  assert.notEqual(next.currentJob.id, running.currentJob.id);
});

test('保留打印失败错误码供界面展示', () => {
  const state = normalizeReport(emptyPrinter(config), { print: { gcode_state: 'FAILED', print_error: 123 } });
  assert.equal(state.status, 'error');
  assert.equal(state.errorCode, 123);
});
