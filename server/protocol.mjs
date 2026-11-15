import { randomUUID } from 'node:crypto';
import { emptyAmsState, invalidateAmsState, mergeAmsVersions, normalizeAmsReport } from './ams.mjs';

export const SPEED_PROFILES = {
  1: { label: '静音', percent: 50 },
  2: { label: '标准', percent: 100 },
  3: { label: '运动', percent: 124 },
  4: { label: '狂暴', percent: 166 },
};

const STATUS_MAP = {
  RUNNING: 'printing',
  PAUSE: 'paused',
  IDLE: 'idle',
  FINISH: 'idle',
  FAILED: 'error',
};

function numeric(value, fallback = 0) {
  if (value == null || value === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function legacyFanPercent(value, fallback) {
  if (!['string', 'number'].includes(typeof value) || String(value).trim() === '') return fallback;
  const speed = numeric(value, null);
  return Number.isInteger(speed) && speed >= 0 && speed <= 15 ? Math.floor(speed / 1.5) * 10 : fallback;
}

function normalizeFans(print, previous) {
  const gear = print.fan_gear;
  if (Number.isInteger(gear) && gear >= 0 && gear <= 0xffffffff) {
    const bytePercent = (shift) => Math.round(((gear >>> shift) & 0xff) / 255 * 100);
    return { partCooling: bytePercent(0), auxiliary: bytePercent(8), chamber: bytePercent(16) };
  }
  return {
    partCooling: legacyFanPercent(print.cooling_fan_speed, previous.partCooling),
    auxiliary: legacyFanPercent(print.big_fan1_speed, previous.auxiliary),
    chamber: legacyFanPercent(print.big_fan2_speed, previous.chamber),
  };
}

function reportedJobId(value) {
  if (typeof value !== 'string' && !Number.isSafeInteger(value)) return null;
  const id = String(value).trim();
  return id && !/^(?:0+|-1)$/.test(id) ? id : null;
}

function normalizeJob(print, previous) {
  const name = print.subtask_name || print.gcode_file;
  const reportedIds = {};
  for (const key of ['subtask_id', 'task_id', 'lan_task_id']) {
    if (Object.hasOwn(print, key)) reportedIds[key] = reportedJobId(print[key]);
  }
  const ids = Object.entries(reportedIds);
  if (!name && !ids.length && !['mc_percent', 'layer_num', 'total_layer_num', 'mc_remaining_time'].some((key) => print[key] != null)) return previous;

  const previousIds = previous?.reportedIds ?? {};
  const identityChanged = ids.some(([key, id]) => previousIds[key] && id !== previousIds[key]);
  const identityMatches = ids.some(([key, id]) => id && id === previousIds[key]);
  const nameChanged = name && previous?.reportedName && name !== previous.reportedName && !identityMatches;
  const old = identityChanged || nameChanged ? null : previous;
  const mergedIds = { ...old?.reportedIds, ...reportedIds };
  const knownName = name || old?.reportedName;
  const hasIdentity = knownName || Object.values(mergedIds).some(Boolean);
  return {
    // Some LAN jobs report placeholder IDs. Track a named job within its observed lifecycle.
    id: hasIdentity ? old?.id ?? randomUUID() : null,
    reportedIds: mergedIds,
    reportedName: knownName ?? null,
    name: knownName || '当前打印任务',
    progress: numeric(print.mc_percent, old?.progress ?? 0),
    layerCurrent: numeric(print.layer_num, old?.layerCurrent ?? 0),
    layerTotal: numeric(print.total_layer_num, old?.layerTotal ?? 0),
    remainingMinutes: numeric(print.mc_remaining_time, old?.remainingMinutes ?? 0),
    elapsedMinutes: old?.elapsedMinutes ?? 0,
  };
}

export function assertStopTarget(printer, expectedJobId) {
  if (!printer.connected || !['printing', 'paused'].includes(printer.status)
    || (printer.gcodeState != null && !['RUNNING', 'PAUSE'].includes(printer.gcodeState))
    || typeof expectedJobId !== 'string' || !expectedJobId || printer.currentJob?.id !== expectedJobId) {
    throw Object.assign(new Error('无法确认这是同一次打印任务，请同步设备状态后重新确认停止'), { statusCode: 409 });
  }
}

export function emptyPrinter(config) {
  return {
    id: config.id,
    name: config.name,
    model: config.model || 'Bambu Lab',
    serial: config.serial,
    ip: config.ip,
    status: 'offline',
    gcodeState: null,
    connected: false,
    currentJob: null,
    lastJob: null,
    temperatures: { nozzle: 0, nozzleTarget: 0, bed: 0, bedTarget: 0, chamber: null },
    fans: { partCooling: 0, auxiliary: 0, chamber: 0 },
    speed: SPEED_PROFILES[2],
    speedLevel: 2,
    lightOn: false,
    ams: [],
    amsState: emptyAmsState(),
    lastUpdated: null,
    errorCode: null,
    lastCommand: null,
  };
}

export function normalizeReport(previous, report, { amsModels = {} } = {}) {
  const next = { ...previous };
  if (report?.info?.command === 'get_version' && Array.isArray(report.info.module)) {
    const versions = mergeAmsVersions(report.info.module, previous.ams);
    const metadata = normalizeAmsReport({}, versions.units, invalidateAmsState(previous.amsState, versions.replacedIds), { amsModels });
    next.ams = metadata.units;
    next.amsState = metadata.state;
  }
  const print = report?.print && (report.print.result == null || report.print.command === 'push_status') ? report.print : null;
  if (print) {
    if (Object.keys(print).some((key) => !['command', 'sequence_id', 'result', 'reason', 'param'].includes(key))) next.lastUpdated = new Date().toISOString();
    if (print.print_error != null) next.errorCode = numeric(print.print_error, previous.errorCode);
    const status = STATUS_MAP[print.gcode_state];
    if (status) next.status = status;
    if (typeof print.gcode_state === 'string') next.gcodeState = print.gcode_state;
    next.temperatures = {
      nozzle: numeric(print.nozzle_temper, previous.temperatures.nozzle),
      nozzleTarget: numeric(print.nozzle_target_temper, previous.temperatures.nozzleTarget),
      bed: numeric(print.bed_temper, previous.temperatures.bed),
      bedTarget: numeric(print.bed_target_temper, previous.temperatures.bedTarget),
      chamber: numeric(print.chamber_temper, previous.temperatures.chamber),
    };
    next.fans = normalizeFans(print, previous.fans);
    if (print.spd_lvl != null && SPEED_PROFILES[print.spd_lvl]) {
      next.speedLevel = Number(print.spd_lvl);
      next.speed = SPEED_PROFILES[print.spd_lvl];
    }
    if (Array.isArray(print.lights_report)) {
      const chamberLight = print.lights_report.find((light) => light.node === 'chamber_light');
      if (chamberLight) next.lightOn = chamberLight.mode === 'on';
    }
    if (print.ams || print.ams_status != null || Array.isArray(print.device?.extruder?.info)) {
      const ams = normalizeAmsReport(print.ams, next.ams, next.amsState, { amsModels, statusCode: print.ams_status, extruders: print.device?.extruder?.info });
      next.ams = ams.units;
      next.amsState = ams.state;
    }
    if (['FINISH', 'IDLE', 'OFFLINE'].includes(next.gcodeState)) {
      if (print.gcode_state === 'FINISH' || print.gcode_state === 'IDLE') {
        next.lastJob = print.subtask_name || print.gcode_file || previous.currentJob?.name || previous.lastJob;
      }
      next.currentJob = null;
    } else {
      const wasActive = ['RUNNING', 'PAUSE'].includes(previous.gcodeState);
      const leftActive = wasActive && !['RUNNING', 'PAUSE'].includes(next.gcodeState);
      next.currentJob = normalizeJob(print, leftActive ? null : previous.currentJob);
      if (next.gcodeState === 'FAILED' && next.currentJob?.id) next.currentJob = { ...next.currentJob, id: null };
    }
  }
  return next;
}

function commandError(message) {
  return Object.assign(new Error(message), { statusCode: 400 });
}

export function createCommand(command, value, sequenceId = 1) {
  const sequence_id = String(sequenceId);
  if (['pause', 'resume', 'stop'].includes(command)) {
    return { print: { command, param: '', sequence_id } };
  }
  if (command === 'light') {
    if (typeof value !== 'boolean') throw commandError('腔灯命令需要布尔值');
    return {
      system: {
        command: 'ledctrl',
        sequence_id,
        led_node: 'chamber_light',
        led_mode: value ? 'on' : 'off',
        led_on_time: 500,
        led_off_time: 500,
        loop_times: 1,
        interval_time: 1000,
      },
    };
  }
  if (command === 'speed') {
    const level = Number(value);
    if (!SPEED_PROFILES[level]) throw commandError('不支持的打印速度');
    return { print: { command: 'print_speed', param: String(level), sequence_id } };
  }
  throw commandError('不支持的控制命令');
}
