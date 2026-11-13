import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createApp } from '../server/app.mjs';
import { MockFleet } from '../server/mock-fleet.mjs';

async function startServer(options = {}) {
  const fleet = new MockFleet();
  const app = createApp(fleet, { demoMode: true, maxCommandsPerWindow: 2, rateLimitWindowMs: 5000, ...options });
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  return {
    fleet,
    baseUrl,
    close: async () => {
      await fleet.close();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

test('HTTP API 返回健康状态、打印机列表并支持控制指令', async () => {
  const { baseUrl, close } = await startServer();
  try {
    const health = await fetch(`${baseUrl}/api/health`).then((res) => res.json());
    assert.equal(health.ok, true);
    assert.equal(health.printerCount, 2);

    const list = await fetch(`${baseUrl}/api/printers`).then((res) => res.json());
    assert.equal(list.printers.length, 2);

    const cmdRes = await fetch(`${baseUrl}/api/printers/h2s/commands`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'http://127.0.0.1:5173' },
      body: JSON.stringify({ command: 'pause' }),
    });
    assert.equal(cmdRes.status, 202);
    const cmdData = await cmdRes.json();
    assert.equal(cmdData.accepted, true);
    assert.equal(cmdData.printer.status, 'paused');
  } finally {
    await close();
  }
});

test('拒绝跨站请求和非法 Origin，并对高频控制指令限流', async () => {
  const { baseUrl, close } = await startServer({ maxCommandsPerWindow: 2, rateLimitWindowMs: 5000 });
  try {
    const crossSite = await fetch(`${baseUrl}/api/printers`, {
      headers: { 'Sec-Fetch-Site': 'cross-site' },
    });
    assert.equal(crossSite.status, 403);

    const badOrigin = await fetch(`${baseUrl}/api/printers/h2s/commands`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' },
      body: JSON.stringify({ command: 'pause' }),
    });
    assert.equal(badOrigin.status, 403);

    for (let i = 0; i < 2; i++) {
      const ok = await fetch(`${baseUrl}/api/printers/h2s/commands`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: 'light', value: i % 2 === 0 }),
      });
      assert.equal(ok.status, 202);
    }

    const limited = await fetch(`${baseUrl}/api/printers/h2s/commands`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: 'light', value: true }),
    });
    assert.equal(limited.status, 429);
  } finally {
    await close();
  }
});

test('SSE 实时推送初始快照并在状态变化时主动广播', async () => {
  const { baseUrl, close } = await startServer();
  const controller = new AbortController();
  try {
    const response = await fetch(`${baseUrl}/api/printers/stream`, { signal: controller.signal });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') || '', /text\/event-stream/);

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const firstChunk = await reader.read();
    const firstText = decoder.decode(firstChunk.value);
    assert.match(firstText, /^data: /);
    const firstPayload = JSON.parse(firstText.replace(/^data: /, '').trim());
    assert.equal(firstPayload.printers[0].status, 'printing');

    await fetch(`${baseUrl}/api/printers/h2s/commands`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: 'pause' }),
    });

    const secondChunk = await reader.read();
    const secondText = decoder.decode(secondChunk.value);
    const secondPayload = JSON.parse(secondText.replace(/^data: /, '').trim());
    assert.equal(secondPayload.printers[0].status, 'paused');
  } finally {
    controller.abort();
    await close();
  }
});
