import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity, ArrowRight, BookOpen, Check, CheckCircle2, CircleHelp,
  Cpu, LayoutDashboard, Layers3, LoaderCircle, Printer as PrinterIcon,
  RefreshCw, Settings2, ShieldCheck, TriangleAlert, Wifi, X,
} from 'lucide-react';
import { getPrinters, sendPrinterCommand, subscribePrinters } from './lib/api';
import type { FleetResponse, Printer, PrinterCommand } from './types';
import { PrinterCard } from './components/PrinterCard';
import { PrinterDetails } from './components/PrinterDetails';
import { Modal } from './components/Modal';
import { ProgressRing } from './components/ProgressRing';

type Filter = 'all' | 'printing' | 'paused' | 'idle' | 'error';
type Toast = { id: number; message: string; kind: 'success' | 'error' };

const FILTER_TABS: readonly { key: Filter; label: string }[] = [
  { key: 'all', label: '全部设备' },
  { key: 'printing', label: '打印中' },
  { key: 'paused', label: '已暂停' },
  { key: 'idle', label: '待命' },
  { key: 'error', label: '异常/离线' },
];

function matchesFilter(printer: Printer, filter: Filter): boolean {
  if (filter === 'all') return true;
  if (filter === 'error') return printer.status === 'error' || printer.status === 'offline';
  return printer.status === filter;
}

function formatMinutes(minutes: number): string {
  if (minutes <= 0) return '0m';
  const hours = Math.floor(minutes / 60);
  return hours ? `${hours}h ${String(minutes % 60).padStart(2, '0')}m` : `${minutes}m`;
}

function App() {
  const [fleet, setFleet] = useState<FleetResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [sseConnected, setSseConnected] = useState(false);
  const [error, setError] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const commandLocks = useRef(new Set<string>());
  const fetchingRef = useRef(false);
  const sseConnectedRef = useRef(false);
  const notifiedRejectionsRef = useRef(new Map<string, string>());
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [modal, setModal] = useState<'settings' | 'help' | null>(null);
  const [stopPrinter, setStopPrinter] = useState<Printer | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);

  const showToast = useCallback((message: string, kind: Toast['kind'] = 'success') => {
    setToast({ id: Date.now(), message, kind });
  }, []);

  const applyFleet = useCallback((data: FleetResponse) => {
    setFleet(data);
    setSelectedId((current) => current ?? data.printers[0]?.id ?? null);
    setError('');
    setLoading(false);
  }, []);

  const loadPrinters = useCallback(async (manual = false) => {
    if (fetchingRef.current && !manual) return;
    fetchingRef.current = true;
    if (manual) setRefreshing(true);
    try {
      const data = await getPrinters();
      applyFleet(data);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '无法连接本地服务');
    } finally {
      fetchingRef.current = false;
      setLoading(false);
      setRefreshing(false);
    }
  }, [applyFleet]);

  useEffect(() => {
    loadPrinters();
    const unsubscribe = subscribePrinters(
      (data) => {
        sseConnectedRef.current = true;
        setSseConnected(true);
        applyFleet(data);
      },
      () => {
        sseConnectedRef.current = false;
        setSseConnected(false);
      },
      () => {
        sseConnectedRef.current = true;
        setSseConnected(true);
      },
    );
    const interval = window.setInterval(() => {
      if (!sseConnectedRef.current && !document.hidden) loadPrinters();
    }, 5000);
    return () => {
      unsubscribe();
      window.clearInterval(interval);
    };
  }, [applyFleet, loadPrinters]);

  useEffect(() => {
    const refreshShortcut = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key.toLowerCase() !== 'r' || modal || stopPrinter) return;
      const target = event.target as HTMLElement | null;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        target instanceof HTMLCanvasElement ||
        target?.isContentEditable
      ) {
        return;
      }
      loadPrinters(true);
    };
    window.addEventListener('keydown', refreshShortcut);
    return () => window.removeEventListener('keydown', refreshShortcut);
  }, [loadPrinters, modal, stopPrinter]);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(null), 3600);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  const printers = useMemo(() => fleet?.printers ?? [], [fleet]);

  useEffect(() => {
    for (const printer of printers) {
      const last = printer.lastCommand;
      if (last?.result === 'rejected') {
        const prevSeq = notifiedRejectionsRef.current.get(printer.id);
        if (prevSeq !== last.sequenceId) {
          notifiedRejectionsRef.current.set(printer.id, last.sequenceId);
          showToast(`${printer.name} 拒绝指令：${last.reason}`, 'error');
        }
      }
    }
  }, [printers, showToast]);

  const selected = printers.find((printer) => printer.id === selectedId) ?? printers[0];
  const visible = printers.filter((printer) => matchesFilter(printer, filter));
  const online = printers.filter((printer) => printer.connected).length;
  const printing = printers.filter((printer) => printer.status === 'printing').length;
  const trayCount = printers.reduce((sum, printer) => sum + (printer.connected ? printer.ams.filter(unit => unit.present !== false).flatMap(unit => unit.trays).filter(tray => tray.empty === false).length : 0), 0);

  async function handleCommand(id: string, command: PrinterCommand, value?: boolean | number) {
    const printer = printers.find((item) => item.id === id);
    if (commandLocks.current.has(id)) return false;
    commandLocks.current.add(id);
    setBusyIds(new Set(commandLocks.current));
    try {
      const result = await sendPrinterCommand(id, command, value);
      setFleet((current) => current ? { ...current, printers: current.printers.map((item) => item.id === id ? result.printer : item) } : current);
      showToast(`${printer?.name ?? '设备'}：${result.message}`);
      return true;
    } catch (reason) {
      showToast(reason instanceof Error ? reason.message : '控制指令发送失败', 'error');
      return false;
    } finally {
      commandLocks.current.delete(id);
      setBusyIds(new Set(commandLocks.current));
    }
  }

  if (loading) return <div className="full-state"><div className="brand-loader"><Layers3 size={30} /></div><LoaderCircle className="spin" size={22} /><p>正在唤醒你的打印工作空间…</p></div>;
  if (!fleet) return <div className="full-state"><div className="error-symbol"><TriangleAlert size={28} /></div><h1>暂时无法连接控制台</h1><p>{error}</p><button className="primary-button" onClick={() => { setLoading(true); loadPrinters(true); }}><RefreshCw size={16} />重新连接</button><small>请确认本地服务已经启动</small></div>;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#" aria-label="竹控工作台"><span className="brand-mark"><Layers3 size={25} strokeWidth={1.6} /></span><strong>竹控<span>STUDIO</span></strong></a>
        <nav className="main-nav" aria-label="主导航">
          <button className="active" title="打印工作台"><LayoutDashboard size={21} /><span>工作台</span></button>
          <button onClick={() => setModal('settings')} title="设备管理"><PrinterIcon size={21} /><span>设备</span></button>
          <button onClick={() => setModal('help')} title="接入指南"><BookOpen size={20} /><span>接入</span></button>
        </nav>
        <div className="sidebar-spacer" />
        <div className="rail-network" title="本地网络"><Wifi size={19} /><span>LAN</span><i /></div>
        <button className="sidebar-settings" onClick={() => setModal('settings')} aria-label="控制台设置"><Settings2 size={20} /></button>
        <div className="avatar" title="本地工作空间">Z</div>
      </aside>
      <main className="main-panel">
        <header className="topbar">
          <div className="breadcrumb"><span className="studio-symbol">✳</span><strong>我的打印工作室</strong><span className="breadcrumb-slash">/</span><span>工作台</span></div>
          <div className="top-actions">
            <span className={'mode-badge ' + fleet.mode}><i />{fleet.mode === 'demo' ? '演示空间' : '局域网已接入'}</span>
            <button className="top-icon" onClick={() => setModal('help')} aria-label="打开帮助"><CircleHelp size={18} /></button>
            <button className="sync-button" onClick={() => loadPrinters(true)} disabled={refreshing}><RefreshCw size={14} className={refreshing ? 'spin' : ''} /><span>{refreshing ? '正在同步' : '同步设备'}</span><kbd>R</kbd></button>
          </div>
        </header>
        <div className="content-wrap">
          {error && <div className="connection-warning"><TriangleAlert size={16} />状态刷新失败：{error}<button onClick={() => loadPrinters(true)}>重试</button></div>}
          <section className="hero-section">
            <div><div className="eyebrow"><span />YOUR PERSONAL MICRO FACTORY</div><h1>打印工作台<span>.</span></h1><p>看见每台机器，让灵感逐层成型。</p></div>
            <div className="workspace-metrics" aria-label="设备统计">
              <div><span><Wifi size={12} />在线设备</span><strong>{String(online).padStart(2, '0')}<small> / {String(printers.length).padStart(2, '0')}</small></strong></div>
              <div><span><Activity size={12} />正在打印</span><strong>{String(printing).padStart(2, '0')}<i className="metric-pulse" /></strong></div>
              <div><span><Layers3 size={12} />已确认耗材</span><strong>{String(trayCount).padStart(2, '0')}<small>卷</small></strong></div>
            </div>
          </section>
          <section className="fleet-section">
            <div className="section-heading"><div><h2>设备现场</h2><span>FLEET / {String(printers.length).padStart(2, '0')}</span></div><div className="filter-tabs" aria-label="设备状态筛选">
              {FILTER_TABS.map(({ key, label }) => {
                const count = printers.filter((printer) => matchesFilter(printer, key)).length;
                return (
                  <button
                    key={key}
                    className={(filter === key ? 'active ' : '') + (key === 'error' && count > 0 ? 'has-alert' : '')}
                    onClick={() => setFilter(key)}
                  >
                    {label}<span>{count}</span>
                  </button>
                );
              })}
            </div></div>
            {visible.length ? <div className="printer-grid">{visible.map(printer => <PrinterCard key={printer.id} printer={printer} index={printers.indexOf(printer) + 1} selected={selected?.id === printer.id} busy={busyIds.has(printer.id)} onSelect={() => setSelectedId(printer.id)} onCommand={(command, value) => handleCommand(printer.id, command, value)} onStop={() => setStopPrinter(printer)} />)}</div> : <div className="empty-filter"><CheckCircle2 size={25} /><strong>当前没有该状态的设备</strong><button onClick={() => setFilter('all')}>查看全部设备</button></div>}
          </section>
          {selected && <section className="lower-grid">
            <PrinterDetails printer={selected} />
            <aside className="activity-panel">
              <div className="activity-heading"><div><span className="mini-label">DEVICE INSIGHT</span><h2>运行摘要</h2></div><span className={'live-indicator ' + (selected.connected ? '' : 'offline')}><i />{selected.connected ? '已连接' : '离线'}</span></div>
              <div className="activity-device"><span className="small-printer-icon"><PrinterIcon size={19} /></span><div><strong>{selected.name}</strong><small>{selected.model}</small></div><Check size={14} /></div>
              {selected.currentJob && (
                <div className="activity-progress">
                  <ProgressRing value={selected.currentJob.progress} paused={selected.status === 'paused'} />
                  <div className="activity-progress-meta">
                    <strong title={selected.currentJob.name}>{selected.currentJob.name}</strong>
                    <span>{selected.currentJob.layerCurrent} / {selected.currentJob.layerTotal} 层</span>
                    <span>已用 {formatMinutes(selected.currentJob.elapsedMinutes)} · 剩余 {formatMinutes(selected.currentJob.remainingMinutes)}</span>
                  </div>
                </div>
              )}
              <div className="insight-line"><span>当前状态</span><strong>{selected.status === 'printing' ? (selected.preparing ? '准备打印' : '正在打印') : selected.status === 'paused' ? '已暂停' : selected.status === 'error' ? '需要检查' : selected.status === 'offline' ? '等待连接' : '待命中'}</strong></div>
              <div className="insight-line"><span>速度模式</span><strong>{selected.speed.label} · {selected.speed.percent}%</strong></div>
              <div className="insight-line"><span>腔体照明</span><strong>{selected.lightOn ? '开启' : '关闭'}<i className={'light-indicator ' + (selected.lightOn ? 'on' : '')} /></strong></div>
              <div className="activity-footer"><ShieldCheck size={14} /><span>{sseConnected ? '本地连接 · 实时事件推送' : '本地连接 · 状态每 5 秒同步'}</span></div>
            </aside>
          </section>}
          <footer className="page-footer"><span>竹控 STUDIO<span className="footer-divider">/</span>MADE FOR MAKERS.</span><span><i />LOCAL NETWORK ONLY<b>·</b>3D 机型示意</span></footer>
        </div>
      </main>

      {modal === 'settings' && <Modal title="设备与连接" eyebrow="CONSOLE SETTINGS" onClose={() => setModal(null)} className="settings-modal">
        <div className={`settings-mode ${fleet.mode}`}><span><Cpu size={20} /></span><div><strong>{fleet.mode === 'demo' ? '当前正在使用演示数据' : '当前正在连接真实打印机'}</strong><p>{fleet.mode === 'demo' ? '可以安全体验所有控制交互，不会影响真实设备。' : '状态来自本地 MQTT，操作将直接发送到打印机。'}</p></div></div>
        <div className="settings-device-list">{printers.map((printer) => <div key={printer.id}><span className="small-printer-icon"><PrinterIcon size={18} /></span><div><strong>{printer.name}</strong><small>Bambu Lab {printer.model} · {printer.ip}</small></div><span className={`connection-state ${printer.connected ? 'online' : ''}`}><i />{printer.connected ? '已连接' : '离线'}</span></div>)}</div>
        <div className="settings-note"><ShieldCheck size={18} /><div><strong>真机凭据不会出现在这个页面</strong><p>请在本机 <code>config/printers.local.json</code> 中配置 IP、序列号和访问码，并在 <code>.env</code> 中设置 <code>DEMO_MODE=false</code>。</p></div></div>
        <div className="modal-actions"><button className="secondary-button" onClick={() => setModal(null)}>关闭</button><button className="primary-button" onClick={() => setModal('help')}>查看接入步骤<ArrowRight size={16} /></button></div>
      </Modal>}

      {modal === 'help' && <Modal title="连接你的两台拓竹打印机" eyebrow="LAN SETUP GUIDE" onClose={() => setModal(null)} className="help-modal">
        <p className="modal-intro">确保电脑与打印机处于同一局域网。建议先在演示模式熟悉操作，再切换真机。</p>
        <ol className="setup-steps">
          <li><span>1</span><div><strong>开启打印机局域网模式</strong><p>在打印机设置中启用 LAN 模式，记录设备序列号与访问码，并记下每台打印机的 IP。</p></div></li>
          <li><span>2</span><div><strong>填写本机设备配置</strong><p>复制 <code>config/printers.example.json</code> 为 <code>config/printers.local.json</code>，分别填入两台设备的信息。</p></div></li>
          <li><span>3</span><div><strong>切换到真机模式</strong><p>复制 <code>.env.example</code> 为 <code>.env</code>，将 <code>DEMO_MODE</code> 改为 <code>false</code>，然后重启本地服务。</p></div></li>
          <li><span>4</span><div><strong>先核对状态，再测试控制</strong><p>确认识别的是正确的设备后，先测试腔灯，再测试暂停与继续。不同固件的兼容性需真机验证。</p></div></li>
        </ol>
        <div className="help-warning"><TriangleAlert size={17} /><p>服务默认仅监听本机地址。不要直接暴露到公网，也不要提交包含访问码的配置文件。</p></div>
        <div className="modal-actions"><button className="primary-button" onClick={() => setModal(null)}><Check size={16} />我知道了</button></div>
      </Modal>}

      {stopPrinter && <Modal title="停止当前打印？" eyebrow="CONFIRM ACTION" onClose={() => setStopPrinter(null)} className="confirm-modal">
        <div className="stop-warning"><span><TriangleAlert size={24} /></span><div><strong>{stopPrinter.name}</strong><p>{stopPrinter.currentJob?.name}</p></div></div>
        <p className="confirm-copy">停止后，当前打印任务将无法从此位置继续。请确认不再需要这次打印。</p>
        <div className="modal-actions"><button className="secondary-button" onClick={() => setStopPrinter(null)}>保留任务</button><button className="danger-button" disabled={busyIds.has(stopPrinter.id)} onClick={async () => { if (await handleCommand(stopPrinter.id, 'stop')) setStopPrinter(null); }}>{busyIds.has(stopPrinter.id) ? <LoaderCircle className="spin" size={16} /> : <X size={16} />}确认停止</button></div>
      </Modal>}

      {toast && <div className={`toast ${toast.kind}`} role="status"><span>{toast.kind === 'success' ? <CheckCircle2 size={19} /> : <TriangleAlert size={19} />}</span><p>{toast.message}</p><button onClick={() => setToast(null)} aria-label="关闭提示"><X size={16} /></button></div>}
    </div>
  );
}

export default App;
