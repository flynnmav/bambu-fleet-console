import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyPrinter, normalizeReport } from '../server/protocol.mjs';
const config = { id: 'h2s', name: 'H2S', model: 'H2S', serial: 'PRINTER', ip: '192.0.2.1' };
const start = () => emptyPrinter(config);
// Cropped public MOCK-H2S fixture, NOT a capture from the user's printers:
// https://github.com/greghesp/ha-bambulab/blob/main/custom_components/bambu_lab/pybambu/mock_data/MOCK-H2S.json
const recordedMock = { print: { command: 'push_status', ams: {
  ams: [{ id: '0', info: '1003', temp: '42.7', humidity: '1', humidity_raw: '36', dry_time: 0,
    tray: [{ id: '0', tray_type: 'ABS', tray_info_idx: 'P8874e68', tray_color: 'FFFFFFFF', remain: -1, state: 11,
      tag_uid: '0000000000000000', tray_uuid: '00000000000000000000000000000000' }] }],
  ams_exist_bits: '1', tray_exist_bits: '1', tray_reading_bits: '0', tray_read_done_bits: '1', tray_now: '0', power_on_flag: false,
} } };
// Constructed from official Bambu Studio bit definitions, NOT a real capture.
const dryingReport = { print: { command: 'push_status', ams: {
  ams: [{ id: '1', info: '540023', temp: '43.2', humidity: '2', humidity_raw: '40', dry_time: 719,
    dry_setting: { dry_temperature: 65, dry_duration: 12, dry_filament: 'PETG' },
    tray: [{ id: '2', tray_type: 'PETG', tray_color: 'FF0000FF', remain: 50 }] }],
  ams_exist_bits: '2', tray_exist_bits: '40', tray_reading_bits: '40', tray_now: '6',
} } };

test('H2S公开固定样例识别2Pro，区分湿度等级、百分比和未知目标', () => {
  const result = normalizeReport(start(), recordedMock).ams[0];
  assert.equal(result.model, 'AMS 2 Pro');
  assert.equal(result.modelSource, 'reported');
  assert.equal(result.present, true);
  assert.equal(result.temperature, 42.7);
  assert.equal(result.humidity, '1');
  assert.equal(result.humidityPercent, 36);
  assert.equal(result.drying.state, 'off');
  assert.equal(result.drying.targetTemperature, null);
  assert.equal(result.trays[0].remaining, null);
  assert.equal(result.trays[0].tagUid, null);
  assert.equal(result.trays[0].empty, false);
});

test('官方位域分别解析烘干阶段、两风扇、分钟倒计时与小时设置', () => {
  const unit = normalizeReport(start(), dryingReport).ams[0];
  assert.equal(unit.id, '1');
  assert.equal(unit.drying.state, 'drying');
  assert.equal(unit.drying.phase, 'heating');
  assert.equal(unit.drying.fan1, 'on');
  assert.equal(unit.drying.fan2, 'on');
  assert.equal(unit.drying.targetTemperature, 65);
  assert.equal(unit.drying.remainingMinutes, 719);
  assert.equal(unit.drying.durationHours, 12);
  assert.equal(unit.activeTrayId, '2');
  assert.equal(unit.trays[0].reading, true);
});

test('高位路由数据不污染两位子状态，info不经过32位截断', () => {
  const report = structuredClone(dryingReport);
  report.print.ams.ams[0].info = (0x540023n | (1n << 24n) | (1n << 33n)).toString(16);
  const unit = normalizeReport(start(), report).ams[0];
  assert.equal(unit.drying.phase, 'heating');
  assert.equal(unit.rawInfo, report.print.ams.ams[0].info);
});

test('按单元和槽位合并增量，保持另一单元及未变字段', () => {
  const first = normalizeReport(normalizeReport(start(), recordedMock), dryingReport);
  const next = normalizeReport(first, { print: { ams: { ams: [{ id: '1', dry_time: 718 }] } } });
  assert.equal(next.ams.length, 2);
  assert.equal(next.ams.find(unit => unit.id === '0').temperature, 42.7);
  const unit = next.ams.find(unit => unit.id === '1');
  assert.equal(unit.temperature, 43.2);
  assert.equal(unit.drying.remainingMinutes, 718);
  assert.equal(unit.drying.targetTemperature, 65);
  assert.equal(unit.trays[0].material, 'PETG');
  assert.equal(first.ams.find(unit => unit.id === '1').drying.remainingMinutes, 719);
});

test('只有湿度等级不生成RH百分比，缺失传感器不默认0', () => {
  const unit = normalizeReport(start(), { print: { ams: { ams: [{ id: '0', humidity: '2' }] } } }).ams[0];
  assert.equal(unit.humidity, '2');
  assert.equal(unit.humidityPercent, null);
  assert.equal(unit.temperature, null);
  assert.equal(unit.model, null);
  assert.equal(unit.drying.state, 'unknown');
});

test('实际0有效，余量0不表示空槽，冷却阶段不按倒计时0改成停止', () => {
  const unit = normalizeReport(start(), { print: { ams: {
    ams: [{ id: '0', info: '33', temp: '0', humidity_raw: '0', dry_time: 0, tray: [{ id: '0', tray_type: 'PLA', remain: 0 }] }],
    tray_exist_bits: '1',
  } } }).ams[0];
  assert.equal(unit.temperature, 0);
  assert.equal(unit.humidityPercent, 0);
  assert.equal(unit.trays[0].remaining, 0);
  assert.equal(unit.trays[0].empty, false);
  assert.equal(unit.drying.state, 'cooling');
});

test('新H2S优先挤出机snow而不是有歧义的legacy tray_now', () => {
  const report = structuredClone(dryingReport);
  report.print.ams.tray_now = '0';
  report.print.device = { extruder: { info: [{ id: 0, snow: 258 }] } };
  const state = normalizeReport(start(), report);
  assert.equal(state.amsState.activeSource, 'extruder');
  assert.equal(state.ams[0].activeTrayId, '2');
  const next = normalizeReport(state, { print: { ams: { tray_now: '0' } } });
  assert.equal(next.ams[0].activeTrayId, '2');
});

test('HT存在位、槽位位图及当前槽位使用各自偏移', () => {
  const state = normalizeReport(start(), { print: { ams: {
    ams: [{ id: '135', info: '2004', humidity: '0', humidity_raw: '28', temp: '27.2', tray: [{ id: '0', state: 9, tray_type: 'PA', remain: 80 }] }],
    ams_exist_bits: '800', tray_exist_bits: '800000', tray_reading_bits: '800000', tray_now: '135',
  } } });
  const unit = state.ams[0];
  assert.equal(unit.model, 'AMS HT');
  assert.equal(unit.present, true);
  assert.equal(unit.humidity, null);
  assert.equal(unit.humidityLevelRaw, '0');
  assert.equal(unit.humidityPercent, 28);
  assert.equal(unit.trays[0].empty, false);
  assert.equal(unit.trays[0].reading, true);
  assert.equal(unit.activeTrayId, '0');
});

test('RFID周期零占位保留同一在位周期缓存，移除后清理身份和活动槽', () => {
  const full = structuredClone(recordedMock);
  full.print.ams.ams[0].tray[0].tag_uid = 'ABCDEF1234567890';
  const first = normalizeReport(start(), full);
  const second = normalizeReport(first, recordedMock);
  assert.equal(second.ams[0].trays[0].tagUid, 'ABCDEF1234567890');
  assert.equal(second.ams[0].trays[0].observedTagUid, null);
  const removed = normalizeReport(second, { print: { ams: { tray_exist_bits: '0' } } });
  assert.equal(removed.ams[0].trays[0].tagUid, null);
  assert.equal(removed.ams[0].trays[0].filamentId, null);
  assert.equal(removed.ams[0].trays[0].material, '未知耗材');
  assert.equal(removed.ams[0].activeTrayId, null);
});

test('模块身份携带AMS序列号与固件，型号冲突不能被配置掩盖', () => {
  const version = normalizeReport(start(), { info: { command: 'get_version', module: [{ name: 'n3f/0', hw_ver: 'N3F05', sw_ver: '03.00.21.29', sn: 'MOCK-H2S-AMS0' }] } });
  assert.equal(version.ams[0].serial, 'MOCK-H2S-AMS0');
  assert.equal(version.ams[0].firmwareVersion, '03.00.21.29');
  assert.equal(version.ams[0].temperature, null);
  const conflict = normalizeReport(version, { print: { ams: { ams: [{ id: '0', info: '1' }] } } }, { amsModels: { 0: 'AMS 2 Pro' } });
  assert.equal(conflict.ams[0].modelConflict, true);
  assert.equal(conflict.ams[0].model, null);
});

test('AMS lite不能冒充具备环境传感器和烘干的AMS2Pro', () => {
  const unit = normalizeReport(start(), { info: { command: 'get_version', module: [{ name: 'ams_f1/0', sn: 'LITE' }] }, print: { ams: { ams: [{ id: '0', info: '2', temp: '0.0', humidity: '5' }] } } }).ams[0];
  assert.equal(unit.model, 'AMS lite');
  assert.equal(unit.drying.supported, false);
  assert.equal(unit.temperature, null);
  assert.equal(unit.humidity, null);
});

test('未识别型号可用显式配置提示，但不会推导温度和烘干状态', () => {
  const unit = normalizeReport(start(), { print: { ams: { ams: [{ id: '0' }] } } }, { amsModels: { 0: 'AMS 2 Pro' } }).ams[0];
  assert.equal(unit.model, 'AMS 2 Pro');
  assert.equal(unit.modelSource, 'configured');
  assert.equal(unit.temperature, null);
  assert.equal(unit.drying.state, 'unknown');
});

test('无效、负值和未来枚举保留未知，不生成正常状态', () => {
  const unit = normalizeReport(start(), { print: { ams: { ams: [{ id: '0', info: 'f9', temp: 'NaN', humidity_raw: '101', dry_time: -1, dry_setting: { dry_temperature: -1, dry_duration: -1 } }] } } }).ams[0];
  assert.equal(unit.model, null);
  assert.equal(unit.drying.state, 'unknown');
  assert.equal(unit.drying.rawState, 15);
  assert.equal(unit.temperature, null);
  assert.equal(unit.humidityPercent, null);
  assert.equal(unit.drying.remainingMinutes, null);
  assert.equal(unit.drying.targetTemperature, null);
});

test('AMS命令回显不会覆盖传感器遥测', () => {
  const initial = normalizeReport(start(), recordedMock);
  const response = normalizeReport(initial, { print: { command: 'ams_filament_setting', result: 'success', ams: { ams: [{ id: '0', temp: '99' }] } } });
  assert.equal(response.ams[0].temperature, 42.7);
  assert.equal(response.lastUpdated, initial.lastUpdated);
});

test('同一接口换AMS序列号时不能继承旧温度、耗材和当前路由', () => {
  const version = sn => ({ info: { command: 'get_version', module: [{ name: 'n3f/0', sn }] } });
  const first = normalizeReport(normalizeReport(start(), version('AMS-A')), recordedMock);
  const detached = normalizeReport(first, { print: { ams: { ams_exist_bits: '0' } } });
  const replaced = normalizeReport(detached, version('AMS-B'));
  const attached = normalizeReport(replaced, { print: { ams: { ams_exist_bits: '1', ams: [{ id: '0', tray: [{ id: '0', tag_uid: '0000' }] }] } } });
  const unit = attached.ams[0];
  assert.equal(unit.serial, 'AMS-B');
  assert.equal(unit.temperature, null);
  assert.equal(unit.humidityPercent, null);
  assert.equal(unit.drying.state, 'unknown');
  assert.equal(unit.activeTrayId, null);
  assert.equal(unit.trays[0].tagUid, null);
  assert.equal(unit.trays[0].remaining, null);
});

test('同一AMS移除后重新接入也需等待新遥测', () => {
  const first = normalizeReport(start(), recordedMock);
  const removed = normalizeReport(first, { print: { ams: { ams_exist_bits: '0' } } });
  const reattached = normalizeReport(removed, { print: { ams: { ams_exist_bits: '1', ams: [{ id: '0' }] } } });
  assert.equal(reattached.ams[0].temperature, null);
  assert.equal(reattached.ams[0].activeTrayId, null);
  assert.equal(reattached.ams[0].trays.length, 0);
});

test('明确移除槽位时同时终止旧RFID读取状态', () => {
  const first = normalizeReport(start(), dryingReport);
  const removed = normalizeReport(first, { print: { ams: { tray_exist_bits: '0' } } });
  assert.equal(removed.ams[0].trays[0].empty, true);
  assert.equal(removed.ams[0].trays[0].reading, false);
  assert.equal(removed.ams[0].trays[0].readDone, false);
});

test('外置、无进料和其他单元供料与未上报区分', () => {
  const first = normalizeReport(start(), recordedMock);
  assert.equal(normalizeReport(first, { print: { ams: { tray_now: '254' } } }).ams[0].feedState, 'external');
  assert.equal(normalizeReport(first, { print: { ams: { tray_now: '255' } } }).ams[0].feedState, 'none');
  assert.equal(normalizeReport(first, { print: { ams: { tray_now: '4' } } }).ams[0].feedState, 'other-unit');
  const noRoute = normalizeReport(start(), { print: { ams: { ams: [{ id: '0' }] } } });
  assert.equal(noRoute.ams[0].feedState, 'unknown');
});
