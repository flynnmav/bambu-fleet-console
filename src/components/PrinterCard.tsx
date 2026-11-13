import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import {
  ArrowUpRight, Check, ChevronDown, Clock3, FileBox, Gauge, Layers3, Lightbulb,
  LoaderCircle, Pause, Play, Printer as PrinterIcon, Square, Thermometer, TriangleAlert,
} from 'lucide-react';
import { SPEED_OPTIONS, type Printer, type PrinterCommand } from '../types';

const PrinterScene = lazy(() => import('./PrinterScene'));
const STATUS = {
  printing: { label: '正在打印', english: 'PRINTING', className: 'printing' },
  idle: { label: '待命', english: 'STANDBY', className: 'idle' },
  paused: { label: '已暂停', english: 'PAUSED', className: 'paused' },
  offline: { label: '离线', english: 'OFFLINE', className: 'offline' },
  error: { label: '需要处理', english: 'ATTENTION', className: 'error' },
};
interface Props {
  printer: Printer;
  index: number;
  selected: boolean;
  busy: boolean;
  onSelect: () => void;
  onCommand: (command: PrinterCommand, value?: boolean | number) => Promise<boolean>;
  onStop: () => void;
}
function formatDuration(minutes: number) {
  if (minutes <= 0) return '—';
  const hours = Math.floor(minutes / 60);
  return hours ? hours + 'h ' + String(minutes % 60).padStart(2, '0') + 'm' : minutes + 'm';
}
export function PrinterCard({ printer, index, selected, busy, onSelect, onCommand, onStop }: Props) {
  const [speedOpen, setSpeedOpen] = useState(false);
  const speedRef = useRef<HTMLDivElement>(null);
  const status = STATUS[printer.status];
  const statusLabel = printer.status === 'printing' && printer.preparing ? '准备中' : status.label;
  const active = printer.status === 'printing' || printer.status === 'paused';
  const job = printer.currentJob;
  const progress = Math.min(100, Math.max(0, job?.progress ?? 0));
  const modelWord = printer.model.toUpperCase().replace('CARBON', '').trim();

  useEffect(() => {
    if (busy || !printer.connected) setSpeedOpen(false);
  }, [busy, printer.connected]);

  useEffect(() => {
    if (!speedOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (speedRef.current && !speedRef.current.contains(event.target as Node)) {
        setSpeedOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSpeedOpen(false);
    };
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [speedOpen]);

  return (
    <article className={'printer-card ' + (selected ? 'selected ' : '') + status.className} data-printer-id={printer.id}>
      <div className="printer-card-header">
        <button className="device-select" onClick={onSelect} aria-label={'查看 ' + printer.name + ' 详情'}>
          <span className="device-kicker"><b>{String(index).padStart(2, '0')}</b><i />BAMBU LAB</span>
          <h3>{printer.model}<ArrowUpRight size={17} /></h3>
          <span className="device-location">{printer.name}</span>
        </button>
        <span className={'status-badge ' + status.className}><i /><span>{statusLabel}<small>{printer.preparing ? 'PREPARING' : status.english}</small></span></span>
      </div>
      <div className="printer-visual">
        <span className="model-watermark" aria-hidden="true">{modelWord}</span>
        <Suspense fallback={<div className="scene-loading"><LoaderCircle className="spin" size={20} /><span>正在准备三维视图</span></div>}>
          <PrinterScene model={printer.model} status={printer.status} progress={progress} lightOn={printer.lightOn} />
        </Suspense>
      </div>
      <div className="printer-card-body">
        {active && job ? <div className="job-overview">
          <div className="job-heading"><span className="mini-label">CURRENT JOB / 当前任务</span><span className="job-percentage">{Math.round(progress)}<small>%</small></span></div>
          <div className="job-file"><FileBox size={14} /><strong title={job.name}>{job.name}</strong></div>
          <div className="job-progress-track"><i style={{ width: progress + '%' }} /></div>
          <div className="job-meta"><span><Layers3 size={12} />{job.layerCurrent} / {job.layerTotal} 层</span><span><Clock3 size={12} />剩余 {formatDuration(job.remainingMinutes)}</span></div>
        </div> : <div className={'idle-overview ' + (printer.status === 'error' ? 'has-error' : '')}>
          <div className="idle-copy"><span className="mini-label">{status.english} / 设备状态</span><strong>{printer.status === 'error' ? '任务异常，请检查设备' : !printer.connected ? '等待设备重新连接' : printer.status === 'idle' ? '一切就绪，等待下一个灵感。' : printer.preparing ? '正在热床调平与准备中…' : '等待打印机状态回报'}</strong><p>{printer.status === 'error' ? '错误码 ' + (printer.errorCode ?? '未知') : printer.lastJob ? '上一任务 · ' + printer.lastJob : '连接后将显示任务信息'}</p></div>
          <span className="idle-symbol">{printer.status === 'error' ? <TriangleAlert size={22} /> : <Check size={24} />}</span>
        </div>}
        <div className="temperature-row">
          <div><span><Thermometer size={13} />喷嘴</span><strong>{Math.round(printer.temperatures.nozzle)}<small> / {Math.round(printer.temperatures.nozzleTarget)}°</small></strong></div>
          <div><span><Gauge size={13} />热床</span><strong>{Math.round(printer.temperatures.bed)}<small> / {Math.round(printer.temperatures.bedTarget)}°</small></strong></div>
          <div><span><PrinterIcon size={13} />腔体</span><strong>{printer.temperatures.chamber == null ? '—' : Math.round(printer.temperatures.chamber)}<small> °C</small></strong></div>
        </div>
      </div>
      {printer.lastCommand && ['rejected', 'unknown'].includes(printer.lastCommand.result) && <div className="command-warning" role="status"><TriangleAlert size={14} /><span>{printer.lastCommand.result === 'rejected' ? '设备拒绝指令' : '指令执行状态未知'}：{printer.lastCommand.reason}</span></div>}
      <div className="printer-controls">
        {printer.status === 'printing' && <button className="control-main" disabled={busy || !printer.connected} onClick={() => onCommand('pause')}><Pause size={14} fill="currentColor" />暂停任务</button>}
        {printer.status === 'paused' && <button className="control-main" disabled={busy || !printer.connected} onClick={() => onCommand('resume')}><Play size={14} fill="currentColor" />继续打印</button>}
        {!active && <button className="control-main secondary" onClick={onSelect}><ArrowUpRight size={16} />设备详情</button>}
        <button className={'control-icon ' + (printer.lightOn ? 'is-on' : '')} disabled={busy || !printer.connected} onClick={() => onCommand('light', !printer.lightOn)} title={printer.lightOn ? '关闭腔灯' : '打开腔灯'} aria-label={printer.lightOn ? '关闭腔灯' : '打开腔灯'}><Lightbulb size={17} /></button>
        <div className="speed-control" ref={speedRef}>
          <button className="speed-button" disabled={busy || !printer.connected} onClick={() => setSpeedOpen(!speedOpen)} aria-expanded={speedOpen}><Gauge size={15} /><span>{printer.speed.percent}%<small>{printer.speed.label}</small></span><ChevronDown size={13} /></button>
          {speedOpen && <div className="speed-menu"><span className="menu-title">打印速度</span>{SPEED_OPTIONS.map(speed => <button key={speed.level} className={printer.speedLevel === speed.level ? 'active' : ''} disabled={busy || !printer.connected} onClick={async () => { if (await onCommand('speed', speed.level)) setSpeedOpen(false); }}><span>{speed.label}<small>{speed.percent}%</small></span>{printer.speedLevel === speed.level && <Check size={15} />}</button>)}</div>}
        </div>
        {active && <button className="control-icon stop-button" disabled={busy || !printer.connected} onClick={onStop} title="停止打印" aria-label={'停止 ' + printer.name + ' 当前打印'}><Square size={13} fill="currentColor" /></button>}
      </div>
    </article>
  );
}
