import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.mjs';
import { BambuFleet } from './bambu-fleet.mjs';
import { MockFleet } from './mock-fleet.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const demoMode = (process.env.DEMO_MODE || 'true').toLowerCase() !== 'false';
const port = Number(process.env.PORT || 8787);
const host = process.env.HOST || '127.0.0.1';

async function createFleet() {
  if (demoMode) return new MockFleet({ simulate: true });
  const configPath = path.join(root, 'config', 'printers.local.json');
  try {
    const configs = JSON.parse(await readFile(configPath, 'utf8'));
    if (!Array.isArray(configs) || configs.length === 0) throw new Error('配置至少需要一台打印机');
    for (const config of configs) {
      const ip = typeof config?.ip === 'string' ? config.ip.trim() : '';
      if (!ip || (net.isIP(ip) === 0 && !/^[a-zA-Z0-9.-]+$/.test(ip))) {
        throw new Error(`打印机 ${config?.id || '(未命名)'} 的 IP 或主机名格式无效`);
      }
      config.ip = ip;
      if (config.amsModels !== undefined && (config.amsModels === null || typeof config.amsModels !== 'object' || Array.isArray(config.amsModels))) {
        throw new Error(`打印机 ${config.id} 的 amsModels 必须为对象映射`);
      }
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
const app = createApp(fleet, { demoMode, distDir: path.join(root, 'dist') });

const server = app.listen(port, host, () => {
  console.log(`Bambu Fleet Console 服务已启动：http://${host}:${port}（${demoMode ? '演示' : '真机'}模式）`);
});

let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  const forceTimer = setTimeout(() => {
    console.warn('关闭服务超时，强制退出');
    process.exit(1);
  }, 3000);
  forceTimer.unref();

  await Promise.allSettled([
    new Promise((resolve) => server.close(() => resolve())),
    fleet.close(),
  ]);
  clearTimeout(forceTimer);
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
