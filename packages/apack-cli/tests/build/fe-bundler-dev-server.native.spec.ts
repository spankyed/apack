import * as fs from 'node:fs';
import * as path from 'node:path';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { pathToFileURL } from 'node:url';
import { expect, it } from 'vitest';
import { packFixture } from '@apackdev/sdk/testing/pack-fixture';
import { packDevServerConfig } from '../../src/build/fe-bundler';
import { REPO_ROOT } from '@apackdev/host/build/packages-built';
import { replaceDir } from '@apackdev/host/replace-dir';

it.runIf(process.platform === 'win32')('publishes staged output while retained dev servers watch authored files', async () => {
  // Realpath'd: on macOS the temp dir is reached through a symlink, outside `server.fs.allow` otherwise
  const packDir = fs.realpathSync(packFixture({ manifest: { id: 'dev-pack', name: 'Dev' }, nodeModules: path.join(REPO_ROOT, 'node_modules') }));
  const entry = path.join(packDir, 'entry.ts');
  fs.writeFileSync(entry, "export { useSurface } from '@apackdev/sdk/fe';\n");
  const vite = await import('vite');
  const config = await packDevServerConfig(packDir, entry);
  const server = await vite.createServer({ ...config, logLevel: 'silent', server: { ...config.server, port: 0, strictPort: false } });
  await server.listen();
  const address = server.httpServer!.address();
  const origin = `http://localhost:${typeof address === 'object' && address !== null ? address.port : 0}`;
  const children: ReturnType<typeof fork>[] = [];
  const staged = path.join(packDir, '.apack', 'build');
  const dest = path.join(packDir, 'dist');
  const ignored = config.server?.watch && config.server.watch.ignored;
  if (typeof ignored !== 'function') throw new Error('Expected a Vite watch predicate');
  expect(ignored(path.toNamespacedPath(staged))).toBe(true);
  expect(ignored(path.join(packDir, 'src/__generated__/entry.ts'))).toBe(false);
  expect(ignored(path.join(path.dirname(packDir), '.apack/dependency.ts'))).toBe(false);
  fs.mkdirSync(path.dirname(staged), { recursive: true });
  const watcher = fs.watch(packDir, { recursive: true }, () => {});
  try {
    for (let i = 0; i < 2; i++) {
      const child = fork(new URL('../_support/vite-dev-server.mjs', import.meta.url), [packDir, entry], {
        cwd: packDir, stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
        execArgv: ['--conditions=@apackdev/source', '--import', pathToFileURL(path.join(REPO_ROOT, 'node_modules/tsx/dist/loader.mjs')).href],
      });
      children.push(child);
      const [message] = await once(child, 'message', { signal: AbortSignal.timeout(15_000) });
      expect(message).toBe('ready');
    }
    for (let iteration = 0; iteration < 10; iteration++) {
      fs.mkdirSync(staged, { recursive: true });
      for (let directory = 0; directory < 12; directory++) {
        const part = path.join(staged, String(directory));
        fs.mkdirSync(part);
        for (let file = 0; file < 12; file++) fs.writeFileSync(path.join(part, `${file}.json`), JSON.stringify(iteration));
      }
      replaceDir(staged, dest);
      expect(fs.readFileSync(path.join(dest, '0/0.json'), 'utf8')).toBe(JSON.stringify(iteration));
    }
    const changed = once(server.watcher, 'change', { signal: AbortSignal.timeout(2_000) });
    fs.appendFileSync(entry, '\nexport const publicationMarker = "AUTHORED_AFTER_PUBLICATION";\n');
    expect(path.normalize((await changed)[0])).toBe(entry);
    expect(await (await fetch(`${origin}/entry.ts`)).text()).toContain('AUTHORED_AFTER_PUBLICATION');
  } finally {
    await server.close();
    watcher.close();
    for (const child of children) {
      if (child.exitCode !== null || child.signalCode !== null) continue;
      const exited = once(child, 'exit');
      const terminate = setTimeout(() => child.kill(), 2_000);
      if (child.connected) child.send('close', () => {}); else child.kill();
      try { await exited; } finally { clearTimeout(terminate); }
    }
  }
});
