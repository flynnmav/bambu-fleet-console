import type { CSSProperties } from 'react';
import { ArrowDownToLine, Box, Droplets, Flame, Radio, ScanLine, Thermometer, Timer } from 'lucide-react';
import type { AmsUnit, Printer } from '../types';

const DRYING_LABELS = {
  off: '未烘干', checking: '检查中', drying: '正在烘干', cooling: '冷却中',
  stopping: '正在停止', error: '烘干异常', unknown: '未上报',
};
function timeLabel(minutes: number | null | undefined) {
  if (minutes == null) return '—';
  return minutes >= 60 ? Math.floor(minutes / 60) + 'h ' + String(minutes % 60).padStart(2, '0') + 'm' : minutes + ' min';
}
function slotName(id: string) {
  return /^\d+$/.test(id) ? String(Number(id) + 1) : id;
}
function serialLabel(serial: string) {
  return serial.length > 8 ? serial.slice(0, 4) + '••••' + serial.slice(-4) : serial;
}
function Unit({ unit, printerOnline }: { unit: AmsUnit; printerOnline: boolean }) {
  const offline = !printerOnline || unit.present === false;
  const drying = unit.drying;
  const state = drying?.state ?? 'unknown';
  const loaded = unit.trays.filter(tray => tray.empty === false).length;
  return (
    <article className={'ams-unit ' + (offline ? 'ams-offline' : '')} data-ams-id={unit.id}>
      <div className="ams-unit-heading">
        <div><span className="mini-label">MATERIAL SYSTEM / 单元 {unit.id}</span><h3>{unit.modelConflict ? 'AMS · 型号来源冲突' : unit.model || 'AMS · 型号未识别'}{unit.modelSource === 'configured' && <small title="型号来自本地配置，未由设备报文确认">配置型号</small>}</h3></div>
        <span className={'ams-connection ' + (offline ? 'offline' : unit.present ? 'online' : '')}><i />{!printerOnline ? '打印机离线 · 历史状态' : unit.present === false ? '未检测到单元' : unit.present ? '已检测' : '存在状态未上报'}</span>
      </div>
      <div className="ams-telemetry">
        <div><span><Thermometer size={13} />箱内温度</span><strong>{unit.temperature == null ? '—' : unit.temperature.toFixed(1)}<small> °C</small></strong><p>{drying?.targetTemperature == null ? '目标温度未上报' : '烘干目标 ' + drying.targetTemperature + '°C'}</p></div>
        <div><span><Droplets size={13} />箱内湿度</span><strong>{unit.humidityPercent == null ? '—' : unit.humidityPercent}<small> %RH</small></strong><p>{unit.humidity == null ? unit.humidityLevelRaw === '0' ? '设备等级未定（原始 0）' : '湿度等级未上报' : '设备湿度等级 ' + unit.humidity}</p></div>
        <div><span><Flame size={13} />烘干状态</span><strong className={'drying-state ' + state}>{drying?.supported === false ? '不支持' : state === 'unknown' && drying?.rawState != null ? '未识别状态' : DRYING_LABELS[state]}</strong><p>{drying?.supported === false ? '该型号无主动烘干' : drying?.rawState === 6 ? '加热失控告警' : drying?.rawState === 7 ? '设备产测状态' : drying?.phase === 'heating' ? '固件阶段：加热' : drying?.phase === 'dehumidifying' ? '固件阶段：排湿' : state === 'unknown' ? '等待设备状态' : '只读状态监控'}</p></div>
        <div><span><Timer size={13} />烘干剩余</span><strong className="drying-time">{timeLabel(drying?.remainingMinutes)}</strong><p>{unit.activeTrayId != null ? '当前进料 · 槽位 ' + slotName(unit.activeTrayId) : unit.feedState === 'external' ? '当前使用外置料架' : unit.feedState === 'none' ? '当前无进料' : unit.feedState === 'other-unit' ? '由其他 AMS 单元供料' : '当前进料槽未上报'}</p></div>
      </div>
      {drying?.supported && <div className="ams-dry-detail"><span>风扇 1：{drying.fan1 === 'on' ? '运行' : drying.fan1 === 'off' ? '关闭' : '未上报'}</span><span>风扇 2：{drying.fan2 === 'on' ? '运行' : drying.fan2 === 'off' ? '关闭' : '未上报'}</span><span>设置时长：{drying.durationHours == null ? '未上报' : drying.durationHours + ' 小时'}</span></div>}
      <div className="ams-tray-heading"><span><Box size={13} />{loaded} 个已确认装载</span><small>{unit.trays.length} 个已上报槽位</small></div>
      {unit.trays.length ? <div className="tray-grid">
        {unit.trays.map(tray => <div className={'tray-card ' + (tray.empty === true ? 'empty ' : '') + (tray.active ? 'tray-active' : '')} key={tray.id}>
          <div className="tray-top"><span className="spool" style={{ '--spool-color': tray.color } as CSSProperties}><i /></span><span className="tray-slot">槽位 {slotName(tray.id)}</span></div>
          <strong title={tray.name || tray.material}>{tray.empty === true ? '空料盘' : tray.name || tray.material}</strong>
          <div className="tray-status">{tray.empty === true ? '未装载' : tray.reading ? <><ScanLine size={11} />RFID 读取中</> : tray.active ? <><ArrowDownToLine size={11} />正在进料</> : tray.empty === false ? tray.material : '装载状态未知'}</div>
          <div className="tray-bottom"><span><i style={{ backgroundColor: tray.color }} />剩余</span><b>{tray.remaining == null ? '—' : tray.remaining + '%'}</b></div>
          <span className="rfid-status" title={tray.tagUid || '未上报可用RFID标识；非RFID耗材也可以正常装载'}>RFID · {tray.tagUid ? tray.observedTagUid ? '已识别' : '上次已识别' : tray.reading ? '读取中' : '未返回标识'}</span>
          {tray.filamentId && <span className="filament-id" title={tray.filamentId}>ID {tray.filamentId}</span>}
        </div>)}
      </div> : <div className="ams-slots-empty">尚未收到该单元的料盘数据</div>}
      <div className="ams-unit-footer"><span>{unit.serial ? 'SN ' + serialLabel(unit.serial) : '单元序列号未上报'}{unit.firmwareVersion ? ' · FW ' + unit.firmwareVersion : ''}</span><span><Radio size={10} />{unit.lastUpdated ? new Date(unit.lastUpdated).toLocaleTimeString('zh-CN', { hour12: false }) : '等待状态同步'}</span></div>
    </article>
  );
}
export function AmsPanel({ printer }: { printer: Printer }) {
  return <div className="ams-content ams-system-panel" role="tabpanel">
    {!printer.connected && <p className="ams-data-note">打印机连接已断开，以下保留最后一次上报数据。</p>}
    {printer.ams.length ? printer.ams.map(unit => <Unit key={unit.id} unit={unit} printerOnline={printer.connected} />) : <div className="inline-empty ams-no-data"><Box size={28} /><strong>尚未收到 AMS 数据</strong><span>连接打印机后，将按实际报文显示 AMS 单元；未上报的指标不会填成 0。</span></div>}
    <p className="ams-data-note">温度、湿度、烘干与料盘信息由打印机转发；“— / 未上报”表示尚无可用数据。</p>
  </div>;
}
