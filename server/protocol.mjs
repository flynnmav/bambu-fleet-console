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

function fanPercent(value) {
  const speed = numeric(value);
  return Math.round(speed > 100 ? (speed / 255) * 100 : speed);
}

export function emptyPrinter(config) {
  return {
    id: config.id,
    name: config.name,
    model: config.model || 'Bambu Lab',
    serial: config.serial,
    ip: config.ip,
    status: 'offline',
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
    next.temperatures = {
      nozzle: numeric(print.nozzle_temper, previous.temperatures.nozzle),
      nozzleTarget: numeric(print.nozzle_target_temper, previous.temperatures.nozzleTarget),
      bed: numeric(print.bed_temper, previous.temperatures.bed),
      bedTarget: numeric(print.bed_target_temper, previous.temperatures.bedTarget),
      chamber: numeric(print.chamber_temper, previous.temperatures.chamber),
    };
    next.fans = {
      partCooling: print.cooling_fan_speed == null ? previous.fans.partCooling : fanPercent(print.cooling_fan_speed),
      auxiliary: print.big_fan1_speed == null ? previous.fans.auxiliary : fanPercent(print.big_fan1_speed),
      chamber: print.big_fan2_speed == null ? previous.fans.chamber : fanPercent(print.big_fan2_speed),
    };
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
    const jobName = print.subtask_name || print.gcode_file;
    if (jobName || ['mc_percent', 'layer_num', 'total_layer_num', 'mc_remaining_time'].some((key) => print[key] != null)) {
      const oldJob = jobName && jobName !== previous.currentJob?.name ? {} : previous.currentJob || {};
      next.currentJob = {
        name: jobName || oldJob.name || '当前打印任务',
        progress: numeric(print.mc_percent, oldJob.progress || 0),
        layerCurrent: numeric(print.layer_num, oldJob.layerCurrent || 0),
        layerTotal: numeric(print.total_layer_num, oldJob.layerTotal || 0),
        remainingMinutes: numeric(print.mc_remaining_time, oldJob.remainingMinutes || 0),
        elapsedMinutes: oldJob.elapsedMinutes || 0,
      };
    }
    if (['FINISH', 'IDLE'].includes(print.gcode_state)) {
      next.lastJob = next.currentJob?.name || previous.lastJob;
      next.currentJob = null;
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
