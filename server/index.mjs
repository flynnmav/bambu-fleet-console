import 'dotenv/config';
import express from 'express';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BambuFleet } from './bambu-fleet.mjs';
import { MockFleet } from './mock-fleet.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const demoMode = (process.env.DEMO_MODE || 'true').toLowerCase() !== 'false';
const port = Number(process.env.PORT || 8787);
const host = process.env.HOST || '127.0.0.1';

async function createFleet() {
  if (demoMode) return new MockFleet();
  const configPath = path.join(root, 'config', 'printers.local.json');
  try {
    const configs = JSON.parse(await readFile(configPath, 'utf8'));
    if (!Array.isArray(configs) || configs.length === 0) throw new Error('配置至少需要一台打印机');
    for (const config of configs) {
      if (config.caCertPath) config.caCertificate = await readFile(path.resolve(root, config.caCertPath));
    }
    return new BambuFleet(configs);
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error(`真机模式缺少本地配置或 CA 证书：${error.path || '请检查配置路径'}`);
    }
    throw error;
  }
}

const fleet = await createFleet();
const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '8kb' }));

app.get('/api/health', (_req, res) => {
  const printers = fleet.getPrinters();
  res.json({
    ok: true,
    mode: demoMode ? 'demo' : 'lan',
    printerCount: printers.length,
    onlineCount: printers.filter((printer) => printer.connected).length,
  });
});

app.get('/api/printers', (_req, res) => {
  res.json({ mode: demoMode ? 'demo' : 'lan', printers: fleet.getPrinters(), serverTime: new Date().toISOString() });
});

app.post('/api/printers/:id/commands', async (req, res, next) => {
  try {
    const { command, value } = req.body || {};
    const printer = await fleet.command(req.params.id, command, value);
    res.status(202).json({
      accepted: true,
      message: demoMode ? '演示状态已更新' : '指令已发送至本机 MQTT，等待打印机状态回报',
      printer,
    });
  } catch (error) {
    next(error);
  }
});

const dist = path.join(root, 'dist');
if (existsSync(dist)) {
  app.use(express.static(dist));
  app.use((req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    res.sendFile(path.join(dist, 'index.html'));
  });
}

app.use((error, _req, res, _next) => {
  console.error(error.message);
  res.status(error.statusCode || 500).json({ error: error.message || '服务器内部错误' });
});

const server = app.listen(port, host, () => {
  console.log(`Bambu Fleet Console 服务已启动：http://${host}:${port}（${demoMode ? '演示' : '真机'}模式）`);
});

async function shutdown() {
  server.close();
  await fleet.close();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
