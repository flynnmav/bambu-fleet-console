import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { transformWithEsbuild } from 'vite';

const source = await readFile(new URL('../src/lib/fleet-refresh.ts', import.meta.url), 'utf8');
const { code } = await transformWithEsbuild(source, 'fleet-refresh.ts', { format: 'esm' });
const { createFleetRefresh } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));

test('暂停完成后发起新查询，较早的轮询响应无法覆盖暂停状态', async () => {
  const polls = [];
  const refresh = createFleetRefresh((signal) => {
    const poll = Promise.withResolvers();
    polls.push({ ...poll, signal });
    return poll.promise;
  });
  const results = [];
  const errors = [];
  let settled = 0;
  const handlers = {
    onResult: (response) => results.push(response.printers[0].status),
    onError: (error) => errors.push(error),
    onSettled: () => { settled += 1; },
  };

  const beforePause = refresh.run(false, handlers);
  await refresh.run(false, handlers);
  assert.equal(polls.length, 1);
  const afterPause = refresh.run(true, handlers);
  assert.equal(polls[0].signal.aborted, true);
  polls[1].resolve({ printers: [{ status: 'paused' }] });
  await afterPause;
  polls[0].resolve({ printers: [{ status: 'printing' }] });
  await beforePause;
  assert.deepEqual(results, ['paused']);
  assert.deepEqual(errors, []);
  assert.equal(settled, 1);
});

test('取消刷新后，旧查询失败不会显示为服务错误', async () => {
  const poll = Promise.withResolvers();
  const refresh = createFleetRefresh(() => poll.promise);
  const request = refresh.run(false, { onResult: assert.fail, onError: assert.fail, onSettled: assert.fail });
  refresh.cancel();
  poll.reject(new Error('obsolete'));
  await request;
});
