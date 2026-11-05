import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity, ArrowRight, BookOpen, Check, CheckCircle2, ChevronRight, CircleHelp,
  Clock3, Cpu, Gauge, LayoutDashboard, Layers3, Leaf, LoaderCircle, Printer as PrinterIcon,
  RefreshCw, Settings2, ShieldCheck, TriangleAlert, Wifi, X,
} from 'lucide-react';
import { getPrinters, sendPrinterCommand } from './lib/api';
import type { FleetResponse, Printer, PrinterCommand, PrinterStatus } from './types';
import { PrinterCard } from './components/PrinterCard';
import { PrinterDetails } from './components/PrinterDetails';
import { Modal } from './components/Modal';

type Filter = 'all' | PrinterStatus;
type Toast = { id: number; message: string; kind: 'success' | 'error' };

function App() {
  const [fleet, setFleet] = useState<FleetResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const commandLocks = useRef(new Set<string>());
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [modal, setModal] = useState<'settings' | 'help' | null>(null);
  const [stopPrinter, setStopPrinter] = useState<Printer | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);

  const showToast = useCallback((message: string, kind: Toast['kind'] = 'success') => {
    setToast({ id: Date.now(), message, kind });
  }, []);

  const loadPrinters = useCallback(async (manual = false) => {
    if (manual) setRefreshing(true);
    try {
      const data = await getPrinters();
      setFleet(data);
      setSelectedId((current) => current ?? data.printers[0]?.id ?? null);
      setError('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '无法连接本地服务');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadPrinters();
    const interval = window.setInterval(() => loadPrinters(), 5000);
    return () => window.clearInterval(interval);
  }, [loadPrinters]);

  useEffect(() => {
    const refreshShortcut = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === 'r' && !modal && !stopPrinter && !(event.target instanceof HTMLInputElement)) loadPrinters(true);
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
  const selected = printers.find((printer) => printer.id === selectedId) ?? printers[0];
  const visible = printers.filter((printer) => filter === 'all' || printer.status === filter);
  const online = printers.filter((printer) => printer.connected).length;
  const printing = printers.filter((printer) => printer.status === 'printing').length;
  const trayCount = printers.reduce((sum, printer) => sum + printer.ams.flatMap((unit) => unit.trays).filter((tray) => !tray.empty).length, 0);

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
        <div className="brand"><span className="brand-mark"><Layers3 size={23} /></span><div><strong>竹控</strong><small>BAMBU FLEET</small></div></div>
        <div className="workspace-switch"><span className="workspace-icon"><Leaf size={17} /></span><div><small>当前工作空间</small><strong>我的打印工作室</strong></div><ChevronRight size={15} /></div>
        <nav className="main-nav" aria-label="主导航">
          <span className="nav-label">控制台</span>
          <button className="active"><LayoutDashboard size={18} /><span>打印总览</span><i>{printers.length}</i></button>
          <button onClick={() => setModal('settings')}><PrinterIcon size={18} /><span>设备管理</span></button>
          <button onClick={() => setModal('help')}><BookOpen size={18} /><span>接入指南</span></button>
        </nav>
        <div className="sidebar-spacer" />
        <div className="local-card"><ShieldCheck size={21} /><strong>数据留在本地</strong><p>设备状态与控制指令仅经过你的局域网。</p><span><i />LOCAL ONLY</span></div>
        <button className="sidebar-settings" onClick={() => setModal('settings')}><Settings2 size={18} /><span>控制台设置</span><ChevronRight size={15} /></button>
        <div className="sidebar-footer"><div className="avatar">ZL</div><div><strong>工作空间管理员</strong><small>本地控制台</small></div><span className="online-dot" /></div>
      </aside>

      <main className="main-panel">
        <header className="topbar">
          <div className="breadcrumb"><span>我的工作空间</span><ChevronRight size={14} /><strong>打印总览</strong></div>
          <div className="top-actions">
            <span className={`mode-badge ${fleet.mode}`}><i />{fleet.mode === 'demo' ? '演示模式' : '真机模式'}</span>
            <button className="top-icon" onClick={() => setModal('help')} aria-label="打开帮助"><CircleHelp size={19} /></button>
            <button className={`top-icon ${refreshing ? 'is-refreshing' : ''}`} onClick={() => loadPrinters(true)} disabled={refreshing} aria-label="同步所有设备"><RefreshCw size={18} /></button>
          </div>
        </header>

        <div className="content-wrap">
          {error && <div className="connection-warning"><TriangleAlert size={16} />状态刷新失败：{error}<button onClick={() => loadPrinters(true)}>重试</button></div>}
          <section className="hero-section">
            <div><div className="eyebrow"><span />LOCAL PRINT WORKSPACE</div><h1>双机打印，<em>一屏掌握。</em></h1><p>无需来回切换设备，让每一次打印都清晰可见、尽在掌控。</p></div>
            <button className="primary-button sync-button" onClick={() => loadPrinters(true)} disabled={refreshing}><RefreshCw size={17} className={refreshing ? 'spin' : ''} />{refreshing ? '正在同步' : '同步设备状态'}<span className="key-hint">R</span></button>
          </section>

          <section className="stats-grid" aria-label="设备统计">
            <div className="stat-card"><span className="stat-icon green"><Wifi size={20} /></span><div><small>在线设备</small><strong>{online}<span> / {printers.length}</span></strong></div><span className="stat-note positive"><i />{online === printers.length ? '全部在线' : '存在离线设备'}</span></div>
            <div className="stat-card"><span className="stat-icon lime"><Activity size={20} /></span><div><small>正在打印</small><strong>{printing}<span> 台</span></strong></div><span className="stat-note">实时任务</span></div>
            <div className="stat-card"><span className="stat-icon amber"><Layers3 size={20} /></span><div><small>在机耗材</small><strong>{trayCount}<span> 卷</span></strong></div><span className="stat-note">AMS 已同步</span></div>
            <div className="stat-card"><span className="stat-icon blue"><Gauge size={20} /></span><div><small>设备利用率</small><strong>{printers.length ? Math.round((printing / printers.length) * 100) : 0}<span>%</span></strong></div><span className="stat-note">当前工作负载</span></div>
          </section>

          <section className="fleet-section">
            <div className="section-heading"><div><h2>设备总览</h2><span>{printers.length} 台打印机</span></div><div className="filter-tabs" aria-label="设备状态筛选">
              {([['all', '全部'], ['printing', '打印中'], ['idle', '空闲']] as const).map(([key, label]) => <button key={key} className={filter === key ? 'active' : ''} onClick={() => setFilter(key)}>{label}<span>{key === 'all' ? printers.length : printers.filter((printer) => printer.status === key).length}</span></button>)}
            </div></div>
            {visible.length ? <div className="printer-grid">{visible.map((printer) => <PrinterCard key={printer.id} printer={printer} selected={selected?.id === printer.id} busy={busyIds.has(printer.id)} onSelect={() => setSelectedId(printer.id)} onCommand={(command, value) => handleCommand(printer.id, command, value)} onStop={() => setStopPrinter(printer)} />)}</div> : <div className="empty-filter"><CheckCircle2 size={25} /><strong>当前没有该状态的设备</strong><button onClick={() => setFilter('all')}>查看全部设备</button></div>}
          </section>

          {selected && <section className="lower-grid">
            <PrinterDetails printer={selected} />
            <aside className="activity-panel">
              <div className="activity-heading"><div><span className="mini-label">LIVE FEED</span><h2>设备动态</h2></div><span className="live-indicator"><i />实时</span></div>
              <div className="activity-device"><span className="small-printer-icon"><PrinterIcon size={17} /></span><div><strong>{selected.name}</strong><small>{selected.model}</small></div><button onClick={() => setSelectedId(selected.id)} aria-label="当前选中设备"><Check size={15} /></button></div>
              <div className="timeline">
                <div className="timeline-item current"><i /><div><strong>{selected.status === 'printing' ? '打印任务正在进行' : selected.status === 'paused' ? '打印任务已暂停' : selected.status === 'error' ? '打印任务异常，请检查设备' : selected.status === 'offline' ? '等待设备连接或状态回报' : '设备已准备就绪'}</strong><p>{selected.currentJob?.name ?? selected.lastJob ?? '等待打印机状态回报'}</p><span>最新状态</span></div></div>
                <div className="timeline-item"><i /><div><strong>{selected.status === 'offline' ? '等待温度状态' : '当前温度已同步'}</strong><p>喷嘴 {Math.round(selected.temperatures.nozzle)}°C · 热床 {Math.round(selected.temperatures.bed)}°C</p><span>当前温度</span></div></div>
                <div className="timeline-item"><i /><div><strong>腔灯已{selected.lightOn ? '开启' : '关闭'}</strong><p>{selected.speed.label}模式 · {selected.speed.percent}% 速度</p><span>设备设置</span></div></div>
              </div>
              <div className="activity-footer"><ShieldCheck size={15} /><span>所有操作均由本地服务发送</span></div>
            </aside>
          </section>}

          <footer className="page-footer"><span>竹控 · 为双机协作而生</span><span><i />每 5 秒自动同步 <b>·</b> v0.1.0</span></footer>
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
