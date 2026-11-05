import { useEffect, useState, type CSSProperties } from 'react';
import { Box, Fan, Info, Layers3, Lightbulb, Link2, Thermometer, Wifi } from 'lucide-react';
import type { Printer } from '../types';

type Tab = 'ams' | 'parameters' | 'connection';

export function PrinterDetails({ printer }: { printer: Printer }) {
  const [tab, setTab] = useState<Tab>('ams');
  useEffect(() => setTab('ams'), [printer.id]);
  const trays = printer.ams.flatMap((unit) => unit.trays);
  const updated = printer.lastUpdated
    ? new Date(printer.lastUpdated).toLocaleTimeString('zh-CN', { hour12: false })
    : '尚未同步';

  return (
    <section className="details-card">
      <div className="details-header">
        <div><span className="mini-label">已选设备</span><h2>{printer.name}<span> · {printer.model}</span></h2></div>
        <div className="detail-tabs" role="tablist" aria-label="设备详情分类">
          <button role="tab" aria-selected={tab === 'ams'} className={tab === 'ams' ? 'active' : ''} onClick={() => setTab('ams')}><Box size={15} />AMS 耗材</button>
          <button role="tab" aria-selected={tab === 'parameters'} className={tab === 'parameters' ? 'active' : ''} onClick={() => setTab('parameters')}><Fan size={15} />打印参数</button>
          <button role="tab" aria-selected={tab === 'connection'} className={tab === 'connection' ? 'active' : ''} onClick={() => setTab('connection')}><Link2 size={15} />连接信息</button>
        </div>
      </div>

      {tab === 'ams' && <div className="ams-content" role="tabpanel">
        <div className="ams-summary">
          <span><Layers3 size={15} />{trays.filter((tray) => !tray.empty).length} 个耗材已装载</span>
          {printer.ams[0] && <span className="humidity-badge"><i />AMS 湿度等级 {printer.ams[0].humidity ?? '未知'}</span>}
        </div>
        {trays.length ? <div className="tray-grid">
          {trays.map((tray, index) => <div className={`tray-card ${tray.empty ? 'empty' : ''}`} key={`${tray.id}-${index}`}>
            <div className="tray-top"><span className="spool" style={{ '--spool-color': tray.color } as CSSProperties}><i /></span><span className="tray-slot">A{index + 1}</span></div>
            <strong>{tray.empty ? '空料盘' : tray.material}</strong>
            <div className="tray-bottom"><span><i style={{ backgroundColor: tray.color }} />{tray.empty ? '未装载' : '剩余耗材'}</span><b>{tray.remaining == null ? '—' : `${tray.remaining}%`}</b></div>
          </div>)}
        </div> : <div className="inline-empty"><Box size={24} /><span>尚未收到 AMS 数据</span></div>}
      </div>}

      {tab === 'parameters' && <div className="parameters-content" role="tabpanel">
        <div className="parameter-block"><span className="mini-label">风扇转速</span>{[
          ['部件冷却', printer.fans.partCooling],
          ['辅助风扇', printer.fans.auxiliary],
          ['腔体风扇', printer.fans.chamber],
        ].map(([label, value]) => <div className="fan-row" key={String(label)}><span>{label}</span><div className="fan-track"><i style={{ width: `${value}%` }} /></div><strong>{value}%</strong></div>)}</div>
        <div className="parameter-side"><div><Fan size={18} /><span>速度模式</span><strong>{printer.speed.label} · {printer.speed.percent}%</strong></div><div><Lightbulb size={18} /><span>腔体照明</span><strong>{printer.lightOn ? '已开启' : '已关闭'}</strong></div></div>
      </div>}

      {tab === 'connection' && <div className="connection-content" role="tabpanel">
        <div><Wifi size={18} /><span>局域网地址</span><strong>{printer.ip}</strong></div>
        <div><Link2 size={18} /><span>设备序列号</span><strong>{printer.serial.length > 10 ? `${printer.serial.slice(0, 4)}••••${printer.serial.slice(-4)}` : printer.serial}</strong></div>
        <div><Thermometer size={18} /><span>最近状态同步</span><strong>{updated}</strong></div>
        <p><Info size={15} />连接凭据仅保存在本机服务配置中，不会通过设备接口返回。</p>
      </div>}
    </section>
  );
}
