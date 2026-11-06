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
  empty?: boolean | null;
  active?: boolean | null;
  reading?: boolean | null;
  name?: string | null;
  filamentId?: string | null;
  tagUid?: string | null;
  observedTagUid?: string | null;
  trayUuid?: string | null;
  readDone?: boolean | null;
  isBambu?: boolean | null;
}

export interface AmsUnit {
  id: string;
  humidity: string | null;
  temperature: number | null;
  model?: string | null;
  modelSource?: 'reported' | 'configured' | null;
  serial?: string | null;
  present?: boolean | null;
  firmwareVersion?: string | null;
  hardwareVersion?: string | null;
  modelConflict?: boolean;
  rawInfo?: string | null;
  humidityLevelRaw?: string | null;
  humidityPercent?: number | null;
  activeTrayId?: string | null;
  feedState?: 'selected' | 'other-unit' | 'external' | 'none' | 'unknown';
  lastUpdated?: string | null;
  drying?: {
    supported: boolean | null;
    state: 'off' | 'checking' | 'drying' | 'cooling' | 'stopping' | 'error' | 'unknown';
    rawState: number | null;
    targetTemperature: number | null;
    remainingMinutes: number | null;
    durationHours?: number | null;
    filament?: string | null;
    phase?: 'off' | 'heating' | 'dehumidifying' | 'unknown';
    fan1?: 'on' | 'off' | 'unknown';
    fan2?: 'on' | 'off' | 'unknown';
  };
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
    chamber: number | null;
  };
  fans: { partCooling: number; auxiliary: number; chamber: number };
  speed: { label: string; percent: number };
  speedLevel: number;
  lightOn: boolean;
  ams: AmsUnit[];
  amsState?: {
    trayNow: number | null;
    trayTarget: number | null;
    activeSource: 'extruder' | 'legacy' | null;
    statusCode: number | null;
  };
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
