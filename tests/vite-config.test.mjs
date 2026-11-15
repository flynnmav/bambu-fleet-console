import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isFileLoadingAllowed, resolveConfig } from 'vite';

test('Vite 开发服务器禁止提供打印机凭据文件，保留默认文件保护', async () => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const config = await resolveConfig({ root }, 'serve');
  for (const filename of ['config/printers.local.json', '.env', '.env.local', 'config/ca.pem', '.git/config']) {
    assert.equal(isFileLoadingAllowed(config, path.join(root, filename)), false, filename);
  }
  assert.equal(isFileLoadingAllowed(config, path.join(root, 'src/App.tsx')), true);
  assert.equal(isFileLoadingAllowed(config, path.join(root, 'config/printers.example.json')), true);
});
