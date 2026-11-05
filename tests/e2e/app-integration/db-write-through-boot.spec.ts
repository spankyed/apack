// A tool changing rows holds no lock, so an app can start while one runs. This keeps a real `apack db script` writing
// across a restart of the real app: both have to come through it, and the app has to end up told.
import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { promisify } from 'node:util';
import { test, expect, type ElectronApplication } from '@playwright/test';
import { waitForAppReady } from '@apackdev/testing';
import { appLaunchEnv } from '../../../packages/apack-testing/src/launch-env.ts';

const root = path.resolve(import.meta.dirname, '../../..');
const CLI = path.join(root, 'packages/apack-cli/bin/apack.mjs');

test('an app starts while a script writes rows, and both come through', async ({ playwright }, testInfo) => {
  test.setTimeout(180_000);
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'apack-write-through-boot-'));
  const stop = path.join(userDataDir, 'stop');
  const script = path.join(userDataDir, 'writes.mjs');
  let app: ElectronApplication | undefined;
  const launch = async () => {
    app = await playwright._electron.launch({ executablePath: createRequire(import.meta.url)('electron'), args: [root], cwd: root,
      env: appLaunchEnv(process.env, userDataDir) });
    const log = fs.createWriteStream(testInfo.outputPath(`app-${Date.now()}.log`));
    app.process().stderr?.pipe(log, { end: false });
    app.once('close', () => log.end());
    await expect.poll(() => app!.windows().some(page => page.url().includes('/renderer/dist/index.html')),
      { timeout: 60_000, message: 'main renderer, rather than the splash window' }).toBe(true);
    const page = app.windows().find(window => window.url().includes('/renderer/dist/index.html'))!;
    await waitForAppReady(page);
    return page;
  };
  try {
    // Once, so the data dir holds a schema a tool can be held to
    await launch();
    await app!.close();
    app = undefined;

    fs.writeFileSync(script, `import fs from 'node:fs';
      export default async ({ db, EARS, log }) => {
        let written = 0;
        while (!fs.existsSync(${JSON.stringify(stop)})) {
          db.ears.create(EARS.Entity.Note, {
            title: 'written through boot ' + written, completed: false, content: '', displayOrder: written,
            hideCompletedChildren: false, icon: '', lastSeen: 0, noteType: 'document',
          });
          written++;
          if (written === 1) log('writing');
          await new Promise((resolve) => setTimeout(resolve, 5));
        }
        return written;
      };`);
    const tool = spawn(process.execPath, [CLI, 'db', 'script', script, '--data-dir', userDataDir],
      { env: { ...process.env, APACK_ENV: 'test' }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    tool.stderr.on('data', (chunk) => { stderr += chunk; });
    const exited = new Promise<number | null>((resolve) => tool.once('close', resolve));
    // Writing before the app starts, so its boot runs entirely beside the tool
    await new Promise<void>((resolve, reject) => {
      tool.stdout.on('data', (chunk) => { stdout += chunk; if (stdout.includes('writing')) resolve(); });
      void exited.then(() => reject(new Error(`The script ended before writing: ${stderr}`)));
    });

    const page = await launch();
    fs.writeFileSync(stop, '');
    // 0 rather than 4: the app that started during the script was told of it
    expect(await exited, stderr).toBe(0);
    const written = Number(stdout.trim().split('\n').at(-1));
    expect(written, stderr).toBeGreaterThan(0);

    await expect(page.getByRole('heading', { name: 'Settings need attention' })).toHaveCount(0);
    const { stdout: counted } = await promisify(execFile)(process.execPath, [CLI, 'db', 'query',
      "return query(EARS.Entity.Note).pickAll(['title']).filter((note) => String(note.title).startsWith('written through boot')).length",
      '--data-dir', userDataDir], { env: { ...process.env, APACK_ENV: 'test' } });
    expect(Number(counted.trim().split('\n').at(-1)), 'every commit landed').toBe(written);
  } finally {
    fs.writeFileSync(stop, '');
    await app?.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});
