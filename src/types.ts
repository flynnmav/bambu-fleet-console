export type PrinterStatus = 'printing' | 'idle' | 'paused' | 'offline' | 'error';
export type PrinterCommand = 'pause' | 'resume' | 'stop' | 'light' | 'speed';

export interface PrintJob {
  name: string;
  progress: number;
  layerCurrent: number;
  layerTotal: number;
  elapsedMinutes: number;
  remainingMinutes: number;
}

export interface AmsTray {
  id: string;
  material: string;
  color: string;
  remaining: number | null;
  empty?: boolean;
}

export interface AmsUnit {
  id: string;
  humidity: string | null;
  temperature: number;
  trays: AmsTray[];
}

export interface Printer {
  id: string;
  name: string;
  model: string;
  serial: string;
  ip: string;
  status: PrinterStatus;
  connected: boolean;
  currentJob: PrintJob | null;
  lastJob: string | null;
  temperatures: {
    nozzle: number;
    nozzleTarget: number;
    bed: number;
    bedTarget: number;
    chamber: number;
  };
  fans: { partCooling: number; auxiliary: number; chamber: number };
  speed: { label: string; percent: number };
  speedLevel: number;
  lightOn: boolean;
  ams: AmsUnit[];
  lastUpdated: string | null;
  errorCode?: number | null;
  lastCommand?: {
    sequenceId: string;
    command: string;
    result: 'sending' | 'sent' | 'acknowledged' | 'rejected' | 'unknown';
    reason: string;
  } | null;
}

export interface FleetResponse {
  mode: 'demo' | 'lan';
  printers: Printer[];
  serverTime: string;
}

export interface CommandResponse {
  accepted: boolean;
  message: string;
  printer: Printer;
}
