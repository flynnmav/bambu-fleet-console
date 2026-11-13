import { emptyAmsState } from './ams.mjs';
import { createCommand, SPEED_PROFILES } from './protocol.mjs';

const initialPrinters = [
  {
    id: 'h2s', name: 'H2S · 主力打印', model: 'H2S', serial: 'DEMO-H2S-001', ip: '192.168.1.101',
    status: 'printing', preparing: false, connected: true,
    currentJob: { name: '齿轮传动盒_v12.gcode', progress: 68, layerCurrent: 172, layerTotal: 252, elapsedMinutes: 112, remainingMinutes: 74 },
    lastJob: '旋翼固定座_v8.gcode',
    temperatures: { nozzle: 218, nozzleTarget: 220, bed: 55, bedTarget: 55, chamber: 36 },
    fans: { partCooling: 80, auxiliary: 60, chamber: 35 },
    speed: SPEED_PROFILES[2], speedLevel: 2, lightOn: true,
    ams: [{ id: '0', model: 'AMS 2 Pro', modelSource: 'reported', serial: 'DEMO-AMS2PRO-001', firmwareVersion: '03.00.00-DEMO', present: true, humidity: '2', humidityPercent: 18, temperature: 48.2, activeTrayId: '0', lastUpdated: new Date().toISOString(), drying: { supported: true, state: 'drying', rawState: 2, targetTemperature: 55, remainingMinutes: 110, durationHours: 2, filament: 'PETG', phase: 'heating', fan1: 'on', fan2: 'on' }, trays: [
      { id: '0', empty: false, active: true, reading: false, filamentId: 'DEMO-FILAMENT-0', material: 'PLA Basic', color: '#252b29', remaining: 68 },
      { id: '1', empty: false, active: false, reading: false, filamentId: 'DEMO-FILAMENT-1', material: 'PLA Matte', color: '#e7e0d1', remaining: 82 },
      { id: '2', empty: false, active: false, reading: false, filamentId: 'DEMO-FILAMENT-2', material: 'PETG HF', color: '#e97848', remaining: 45 },
      { id: '3', empty: false, active: false, reading: false, filamentId: 'DEMO-FILAMENT-3', material: 'PLA Basic', color: '#4e8968', remaining: 73 },
    ] }],
    amsState: { ...emptyAmsState(), trayNow: 0, existBits: '1', trayExistBits: 'f', activeSource: 'extruder' },
    lastUpdated: new Date().toISOString(),
    errorCode: null,
    lastCommand: null,
  },
  {
    id: 'a1', name: 'A1 · 桌面打印', model: 'A1', serial: 'DEMO-A1-002', ip: '192.168.1.102',
    status: 'idle', preparing: false, connected: true, currentJob: null, lastJob: '无人机电机座.gcode',
    temperatures: { nozzle: 32, nozzleTarget: 0, bed: 31, bedTarget: 0, chamber: null },
    fans: { partCooling: 0, auxiliary: 0, chamber: 0 },
    speed: SPEED_PROFILES[2], speedLevel: 2, lightOn: false,
    ams: [],
    amsState: emptyAmsState(),
    lastUpdated: new Date().toISOString(),
    errorCode: null,
    lastCommand: null,
  },
];

function copy(value) {
  return structuredClone(value);
}

export class MockFleet {
  constructor({ simulate = false, intervalMs = 3000 } = {}) {
    this.printers = copy(initialPrinters);
    this.listeners = new Set();
    this.tickCount = 0;
    this.timer = null;
    if (simulate) {
      this.timer = setInterval(() => this.step(), intervalMs);
      this.timer.unref?.();
    }
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit() {
    const snapshot = this.getPrinters();
    for (const listener of this.listeners) {
      try {
        listener(snapshot);
      } catch {
        // ignore listener errors
      }
    }
  }

  step() {
    this.tickCount += 1;
    let changed = false;
    for (const printer of this.printers) {
      if (printer.status === 'printing' && printer.currentJob) {
        const delta = (this.tickCount % 2 === 0 ? 0.2 : -0.2);
        printer.temperatures.nozzle = Number((printer.temperatures.nozzleTarget + delta).toFixed(1));
        printer.temperatures.bed = Number((printer.temperatures.bedTarget + delta * 0.5).toFixed(1));
        if (this.tickCount % 4 === 0 && printer.currentJob.progress < 99) {
          printer.currentJob.progress = Math.min(99, printer.currentJob.progress + 1);
          printer.currentJob.layerCurrent = Math.min(
            printer.currentJob.layerTotal,
            Math.round((printer.currentJob.progress / 100) * printer.currentJob.layerTotal),
          );
          printer.currentJob.elapsedMinutes += 1;
          printer.currentJob.remainingMinutes = Math.max(1, printer.currentJob.remainingMinutes - 1);
        }
        printer.lastUpdated = new Date().toISOString();
        changed = true;
      } else if (printer.status === 'paused' && printer.temperatures.nozzle > 40) {
        printer.temperatures.nozzle = Math.max(40, Number((printer.temperatures.nozzle - 0.5).toFixed(1)));
        printer.lastUpdated = new Date().toISOString();
        changed = true;
      }
    }
    if (changed) this.emit();
  }

  getPrinters() {
    return copy(this.printers);
  }

  async command(id, command, value) {
    createCommand(command, value);
    const printer = this.printers.find((item) => item.id === id);
    if (!printer) {
      const error = new Error('未找到打印机');
      error.statusCode = 404;
      throw error;
    }
    if (command === 'pause' && printer.status === 'printing') printer.status = 'paused';
    if (command === 'resume' && printer.status === 'paused') printer.status = 'printing';
    if (command === 'stop' && ['printing', 'paused'].includes(printer.status)) {
      printer.lastJob = printer.currentJob?.name || printer.lastJob;
      printer.currentJob = null;
      printer.status = 'idle';
      printer.temperatures.nozzleTarget = 0;
      printer.temperatures.bedTarget = 0;
    }
    if (command === 'light') printer.lightOn = Boolean(value);
    if (command === 'speed') {
      printer.speedLevel = Number(value);
      printer.speed = SPEED_PROFILES[Number(value)];
    }
    printer.lastUpdated = new Date().toISOString();
    this.emit();
    return copy(printer);
  }

  async close() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
