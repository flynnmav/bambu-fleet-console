import { useState } from 'react';
import {
  Check, ChevronDown, Clock3, FileBox, Gauge, Layers3, Lightbulb,
  Pause, Play, Printer as PrinterIcon, Square, Thermometer, TriangleAlert, WifiOff,
} from 'lucide-react';
import type { Printer, PrinterCommand } from '../types';
import { ProgressRing } from './ProgressRing';

const STATUS = {
  printing: { label: '正在打印', className: 'printing' },
  idle: { label: '空闲', className: 'idle' },
  paused: { label: '已暂停', className: 'paused' },
  offline: { label: '离线', className: 'offline' },
  error: { label: '需处理', className: 'error' },
};

const SPEEDS = [
  { level: 1, label: '静音', percent: 50 },
  { level: 2, label: '标准', percent: 100 },
  { level: 3, label: '运动', percent: 124 },
  { level: 4, label: '狂暴', percent: 166 },
];

interface Props {
  printer: Printer;
  selected: boolean;
  busy: boolean;
  onSelect: () => void;
  onCommand: (command: PrinterCommand, value?: boolean | number) => Promise<boolean>;
  onStop: () => void;
}

function formatDuration(minutes: number) {
  if (minutes <= 0) return '—';
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return hours ? `${hours} 小时 ${String(mins).padStart(2, '0')} 分` : `${mins} 分钟`;
}

export function PrinterCard({ printer, selected, busy, onSelect, onCommand, onStop }: Props) {
  const [speedOpen, setSpeedOpen] = useState(false);
  const status = STATUS[printer.status];
  const active = printer.status === 'printing' || printer.status === 'paused';
  const job = printer.currentJob;

  return (
    <article className={`printer-card ${selected ? 'selected' : ''} ${status.className}`}>
      <button className="card-select-area" onClick={onSelect} aria-label={`查看 ${printer.name} 详情`} />
      <div className="printer-card-header">
        <div className="printer-identity">
          <div className="printer-icon"><PrinterIcon size={21} strokeWidth={1.8} /></div>
          <div><h3>{printer.name}</h3><p>Bambu Lab {printer.model}</p></div>
        </div>
        <span className={`status-badge ${status.className}`}><i />{status.label}</span>
      </div>

      <div className="printer-card-body">
        {active && job ? (
          <div className="job-overview">
            <div className="job-copy">
              <span className="mini-label">当前任务</span>
              <div className="job-file"><FileBox size={16} /><strong title={job.name}>{job.name}</strong></div>
              <div className="job-meta"><span><Layers3 size={14} />{job.layerCurrent} / {job.layerTotal} 层</span><span><Clock3 size={14} />{formatDuration(job.remainingMinutes)}</span></div>
            </div>
            <ProgressRing value={job.progress} paused={printer.status === 'paused'} />
          </div>
        ) : (
          <div className="idle-overview">
            <div className={`idle-symbol ${printer.connected ? '' : 'is-offline'}`}>
              {printer.status === 'error' ? <TriangleAlert size={26} /> : printer.status === 'idle' && printer.connected ? <Check size={28} /> : <WifiOff size={26} />}
            </div>
            <div><strong>{printer.status === 'error' ? '打印任务异常，请检查设备' : !printer.connected ? '设备连接已断开' : printer.status === 'idle' ? '设备就绪，等待新任务' : '等待打印机状态回报'}</strong><p>{printer.status === 'error' ? `错误码：${printer.errorCode ?? '未知'}，请查看设备屏幕` : printer.lastJob ? `上一任务：${printer.lastJob}` : '请检查打印机与局域网连接'}</p></div>
          </div>
        )}

        <div className="temperature-row">
          <div><span><Thermometer size={14} />喷嘴</span><strong>{Math.round(printer.temperatures.nozzle)}<small> / {Math.round(printer.temperatures.nozzleTarget)}°C</small></strong></div>
          <div><span><Gauge size={14} />热床</span><strong>{Math.round(printer.temperatures.bed)}<small> / {Math.round(printer.temperatures.bedTarget)}°C</small></strong></div>
          <div><span><PrinterIcon size={14} />腔体</span><strong>{Math.round(printer.temperatures.chamber)}<small>°C</small></strong></div>
        </div>
      </div>

      {printer.lastCommand && ['rejected', 'unknown'].includes(printer.lastCommand.result) && <div className="command-warning" role="status"><TriangleAlert size={14} /><span>{printer.lastCommand.result === 'rejected' ? '设备拒绝指令' : '指令执行状态未知'}：{printer.lastCommand.reason}</span></div>}

      <div className="printer-controls">
        {printer.status === 'printing' && <button className="control-main" disabled={busy} onClick={() => onCommand('pause')}><Pause size={16} fill="currentColor" />暂停</button>}
        {printer.status === 'paused' && <button className="control-main" disabled={busy} onClick={() => onCommand('resume')}><Play size={16} fill="currentColor" />继续</button>}
        {!active && <button className="control-main" onClick={onSelect}><PrinterIcon size={16} />设备详情</button>}
        <button className={`control-icon ${printer.lightOn ? 'is-on' : ''}`} disabled={busy || !printer.connected} onClick={() => onCommand('light', !printer.lightOn)} title={printer.lightOn ? '关闭腔灯' : '打开腔灯'} aria-label={printer.lightOn ? '关闭腔灯' : '打开腔灯'}><Lightbulb size={17} /></button>
        <div className="speed-control">
          <button className="speed-button" disabled={busy || !printer.connected} onClick={() => setSpeedOpen(!speedOpen)} aria-expanded={speedOpen}><Gauge size={16} /><span>{printer.speed.label} · {printer.speed.percent}%</span><ChevronDown size={14} /></button>
          {speedOpen && <div className="speed-menu">
            <span className="menu-title">打印速度</span>
            {SPEEDS.map((speed) => <button key={speed.level} className={printer.speedLevel === speed.level ? 'active' : ''} disabled={busy || !printer.connected} onClick={async () => { if (await onCommand('speed', speed.level)) setSpeedOpen(false); }}><span>{speed.label}<small>{speed.percent}%</small></span>{printer.speedLevel === speed.level && <Check size={15} />}</button>)}
          </div>}
        </div>
        {active && <button className="control-icon stop-button" disabled={busy} onClick={onStop} title="停止打印" aria-label={`停止 ${printer.name} 当前打印`}><Square size={15} fill="currentColor" /></button>}
      </div>
    </article>
  );
}
