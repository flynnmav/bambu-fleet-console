import express from 'express';
import { existsSync } from 'node:fs';
import path from 'node:path';

const LOCAL_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '[::1]']);

function parseHostname(hostHeader) {
  if (!hostHeader) return '';
  try {
    return new URL(`http://${hostHeader}`).hostname;
  } catch {
    return '';
  }
}

export function createApp(
  fleet,
  { demoMode = true, rateLimitWindowMs = 1000, maxCommandsPerWindow = 4, distDir = '' } = {},
) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '8kb' }));

  const commandHistory = new Map();

  app.use('/api', (req, res, next) => {
    const fetchSite = req.get('sec-fetch-site');
    if (fetchSite && fetchSite.toLowerCase() === 'cross-site') {
      return res.status(403).json({ error: '禁止跨站访问本地控制台接口' });
    }
    if (['POST', 'PUT', 'DELETE'].includes(req.method)) {
      const origin = req.get('origin');
      if (origin) {
        try {
          const parsed = new URL(origin);
          const hostName = parseHostname(req.get('host'));
          if (!LOCAL_HOSTNAMES.has(parsed.hostname) && (!hostName || parsed.hostname !== hostName)) {
            return res.status(403).json({ error: '请求来源不被允许' });
          }
        } catch {
          return res.status(403).json({ error: '无效的请求来源' });
        }
      }
    }
    next();
  });

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
    res.json({
      mode: demoMode ? 'demo' : 'lan',
      printers: fleet.getPrinters(),
      serverTime: new Date().toISOString(),
    });
  });

  app.get('/api/printers/stream', (req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    const sendSnapshot = (printers) => {
      if (res.writableEnded) return;
      const payload = {
        mode: demoMode ? 'demo' : 'lan',
        printers,
        serverTime: new Date().toISOString(),
      };
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    };

    sendSnapshot(fleet.getPrinters());
    const unsubscribe = typeof fleet.subscribe === 'function' ? fleet.subscribe(sendSnapshot) : () => {};
    const heartbeat = setInterval(() => {
      if (!res.writableEnded) res.write(': heartbeat\n\n');
    }, 15000);
    heartbeat.unref?.();

    req.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
      if (!res.writableEnded) res.end();
    });
  });

  app.post('/api/printers/:id/commands', async (req, res, next) => {
    try {
      const printerId = req.params.id;
      const now = Date.now();
      const recent = (commandHistory.get(printerId) || []).filter((ts) => now - ts < rateLimitWindowMs);
      if (recent.length >= maxCommandsPerWindow) {
        return res.status(429).json({ error: '指令发送过于频繁，请稍后再试' });
      }
      recent.push(now);
      commandHistory.set(printerId, recent);

      const { command, value } = req.body || {};
      const printer = await fleet.command(printerId, command, value);
      res.status(202).json({
        accepted: true,
        message: demoMode ? '演示状态已更新' : '指令已发送至本机 MQTT，等待打印机状态回报',
        printer,
      });
    } catch (error) {
      next(error);
    }
  });

  if (distDir && existsSync(distDir)) {
    app.use(express.static(distDir));
    app.use((req, res, next) => {
      if (req.path.startsWith('/api/')) return next();
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.use((error, _req, res, _next) => {
    console.error(error.message);
    res.status(error.statusCode || 500).json({ error: error.message || '服务器内部错误' });
  });

  return app;
}
