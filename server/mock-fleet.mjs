import { createCommand, SPEED_PROFILES } from './protocol.mjs';

const initialPrinters = [
  {
    id: 'x1c', name: '工作室 · 01', model: 'X1 Carbon', serial: 'DEMO-X1C-001', ip: '192.168.1.101',
    status: 'printing', connected: true,
    currentJob: { name: '齿轮传动盒_v12.gcode', progress: 68, layerCurrent: 172, layerTotal: 252, elapsedMinutes: 112, remainingMinutes: 74 },
    lastJob: '旋翼固定座_v8.gcode',
    temperatures: { nozzle: 218, nozzleTarget: 220, bed: 55, bedTarget: 55, chamber: 36 },
    fans: { partCooling: 80, auxiliary: 60, chamber: 35 },
    speed: SPEED_PROFILES[2], speedLevel: 2, lightOn: true,
    ams: [{ id: '0', humidity: '2', temperature: 29, trays: [
      { id: '0', material: 'PLA Basic', color: '#252b29', remaining: 68 },
      { id: '1', material: 'PLA Matte', color: '#e7e0d1', remaining: 82 },
      { id: '2', material: 'PETG HF', color: '#e97848', remaining: 45 },
      { id: '3', material: 'PLA Basic', color: '#4e8968', remaining: 73 },
    ] }],
    lastUpdated: new Date().toISOString(),
  },
  {
    id: 'p1s', name: '工作室 · 02', model: 'P1S', serial: 'DEMO-P1S-002', ip: '192.168.1.102',
    status: 'idle', connected: true, currentJob: null, lastJob: '无人机电机座.gcode',
    temperatures: { nozzle: 32, nozzleTarget: 0, bed: 31, bedTarget: 0, chamber: 29 },
    fans: { partCooling: 0, auxiliary: 0, chamber: 0 },
    speed: SPEED_PROFILES[2], speedLevel: 2, lightOn: false,
    ams: [{ id: '0', humidity: '1', temperature: 27, trays: [
      { id: '0', material: 'PLA Basic', color: '#ddd8cc', remaining: 91 },
      { id: '1', material: 'PLA Basic', color: '#303736', remaining: 57 },
      { id: '2', material: 'PETG Basic', color: '#6a8fa5', remaining: 64 },
      { id: '3', material: 'PLA Silk', color: '#b397c4', remaining: 38 },
    ] }],
    lastUpdated: new Date().toISOString(),
  },
];

function copy(value) {
  return structuredClone(value);
}

export class MockFleet {
  constructor() {
    this.printers = copy(initialPrinters);
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
    return copy(printer);
  }

  async close() {}
}
