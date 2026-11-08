import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import { execFileWhileWorking } from '@apackdev/sdk/progress';
import { packagedOptions, selectPackagedApp, resetTargets, startPackagedApp, verifyPackagedSigning, REPO_ROOT } from '../../../scripts/lib/packaged-app.ts';
import { resolveBuildMetadata } from '../../../build/build-metadata.ts';

const roots: string[] = [];
afterEach(() => { vi.unstubAllEnvs(); for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'packaged-tools-'));
  roots.push(root);
  const metadata = resolveBuildMetadata({ APACK_ENV: 'preview', APACK_BUILD_VERSION: '0.4.0-preview.1' });
  const app = path.join(root, 'dist/preview', process.arch === 'arm64' ? 'mac-arm64' : 'mac', metadata.productName + '.app');
  const resource = path.join(app, 'Contents/Resources/app');
  fs.mkdirSync(resource, { recursive: true });
  fs.writeFileSync(path.join(resource, 'build-manifest.json'), JSON.stringify(metadata));
  const executable = path.join(app, 'Contents/MacOS', metadata.productName);
  fs.mkdirSync(path.dirname(executable), { recursive: true });
  fs.writeFileSync(executable, '#!/bin/sh\necho selected-preview\necho node-mode=${ELECTRON_RUN_AS_NODE:-unset}\nexit 7\n', { mode: 0o755 });
  return { root, app };
}
it('selects local previews and refuses mismatched channels and unknown arguments', () => {
  const { root, app } = fixture();
  const options = packagedOptions(['--channel', 'preview']);
  expect(selectPackagedApp(options, root, path.join(root, 'Applications')).appPath).toBe(app);
  expect(() => selectPackagedApp({ channel: 'production', app })).toThrow(/identity/);
  expect(() => packagedOptions(['--channel', 'dev'])).toThrow();
  expect(() => packagedOptions(['--beta'])).toThrow();
  expect(() => selectPackagedApp({ channel: 'preview', app: path.join(root, 'missing.app') })).toThrow(/No preview app/);
});
it.skipIf(process.platform !== 'darwin')('limits reset to selected data and preserves builds, diagnostics and other profiles', async () => {
  const { root, app } = fixture();
  const data = path.join(root, 'preview-data');
  const other = path.join(root, 'other-data');
  const diagnostics = path.join(root, 'diagnostics');
  for (const dir of [data, other, diagnostics]) { fs.mkdirSync(dir); fs.writeFileSync(path.join(dir, 'keep'), 'data'); }
  const selected = selectPackagedApp({ channel: 'preview', app, dataDir: data });
  expect(resetTargets(selected)).toContain(data);
  expect(() => resetTargets({ ...selected, context: { ...selected.context, userDataDir: os.homedir() } })).toThrow(/protected/);
  await execFileWhileWorking(process.execPath, ['--import', 'tsx', path.join(REPO_ROOT, 'scripts/packaged-app.ts'), 'reset', '--channel', 'preview', '--app', app, '--data-dir', data]);
  expect(fs.existsSync(data)).toBe(false);
  for (const dir of [other, diagnostics, app]) expect(fs.existsSync(dir)).toBe(true);
});
it.skipIf(process.platform === 'win32')('preserves the app exit status and captures output', async () => {
  const { root, app } = fixture();
  vi.stubEnv('ELECTRON_RUN_AS_NODE', '1');
  const selected = selectPackagedApp({ channel: 'preview', app, dataDir: path.join(root, 'data') });
  const log = path.join(root, 'session.log');
  expect(await startPackagedApp(selected, log)).toBe(7);
  expect(fs.readFileSync(log, 'utf8')).toContain('selected-preview');
  expect(fs.readFileSync(log, 'utf8')).toContain('node-mode=unset');
});

it.skipIf(process.platform !== 'darwin')('collects the selected bundle and profile rather than the installed production app', async () => {
  const { root, app } = fixture();
  const selected = selectPackagedApp({ channel: 'preview', app, dataDir: path.join(root, 'data') });
  const server = path.join(selected.appDir, 'packages/api/dist/server.js');
  fs.mkdirSync(path.dirname(server), { recursive: true });
  fs.writeFileSync(server, 'preview-api');
  fs.writeFileSync(path.join(app, 'Contents/Info.plist'), '<plist/>');
  fs.mkdirSync(selected.logsDir, { recursive: true });
  fs.writeFileSync(path.join(selected.logsDir, 'main.log'), 'preview-log');
  const { stdout: output } = await execFileWhileWorking(process.execPath, ['--import', 'tsx', path.join(REPO_ROOT, 'scripts/packaged-app.ts'), 'diagnostics', '--channel', 'preview', '--app', app, '--data-dir', selected.context.userDataDir]);
  const out = output.trim().split('\n').at(-1)!;
  expect(out.startsWith(path.join(REPO_ROOT, 'diagnostics/preview') + path.sep)).toBe(true);
  roots.push(out);
  const summary = JSON.parse(fs.readFileSync(path.join(out, 'summary.json'), 'utf8'));
  expect(summary.metadata.version).toBe('0.4.0-preview.1');
  expect(summary.appPath).toBe(app);
  expect(summary.apiSha256).toBe(createHash('sha256').update('preview-api').digest('hex'));
  expect(fs.readFileSync(path.join(out, 'logs/main.log'), 'utf8')).toBe('preview-log');
});

it('reports any signing failure even if the later assessments succeed', () => {
  const { app } = fixture();
  const selected = selectPackagedApp({ channel: 'preview', app });
  const commands: string[] = [];
  const failures = verifyPackagedSigning(selected, (command, args) => {
    commands.push(command);
    expect(args).toContain(app);
    if (command === 'codesign') throw new Error('invalid signature');
  });
  expect(commands).toEqual(['codesign', 'xcrun', 'spctl']);
  expect(failures).toHaveLength(1);
  expect(failures[0]).toContain('invalid signature');
  expect(verifyPackagedSigning(selected, () => {})).toEqual([]);
});

it.skipIf(process.platform !== 'darwin')('returns a failing exit code from the signing command when the last check succeeds', async () => {
  const { root, app } = fixture();
  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin);
  for (const command of ['codesign', 'xcrun', 'spctl']) {
    fs.writeFileSync(path.join(bin, command), `#!/bin/sh\nexit ${command === 'codesign' ? 1 : 0}\n`, { mode: 0o755 });
  }
  let result: { code?: unknown; stdout: string; stderr: string };
  try {
    result = await execFileWhileWorking(process.execPath, ['--import', 'tsx', path.join(REPO_ROOT, 'scripts/packaged-app.ts'), 'verify-signing', '--channel', 'preview', '--app', app], {
      env: { ...process.env, PATH: bin + path.delimiter + process.env.PATH },
    });
  } catch (error) {
    result = error as { code: unknown; stdout: string; stderr: string };
  }
  expect(result.code).toBe(1);
  expect(result.stdout).toContain('Gatekeeper');
  expect(result.stderr).toContain('Code signature');
});
