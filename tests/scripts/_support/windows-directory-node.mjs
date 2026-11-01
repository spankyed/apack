// Observe the application's actual standard-library path, not an alternate native binding.
import assert from 'node:assert/strict';
import { closeSync, existsSync, fsyncSync, mkdirSync, mkdtempSync, openSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir, release } from 'node:os';
import { dirname, join, resolve } from 'node:path';

assert(process.platform === 'win32' && process.env.GITHUB_ACTIONS === 'true');
const output = resolve(process.argv[2]);
assert(!existsSync(output)); mkdirSync(dirname(output), { recursive: true });
const root = mkdtempSync(join(tmpdir(), 'ears-node-directory-'));
const report = { source: process.env.GITHUB_SHA, qualification: false, node: process.version,
  uv: process.versions.uv, os: release(), cases: [],
  scope: 'Actual Node open/fsync results only; not a supported directory persistence or power-loss contract' };
try {
  const control = openSync(join(root, 'control'), 'wx', 0o600);
  try { writeFileSync(control, 'normal-file'); fsyncSync(control); report.fileFlushControl = true; }
  finally { closeSync(control); }
  for (const flags of ['r', 'r+']) {
    const entry = { flags }; report.cases.push(entry);
    let fd;
    try {
      fd = openSync(root, flags); entry.opened = true;
      try { fsyncSync(fd); entry.flushBefore = true; }
      catch (error) { entry.flushBefore = false; entry.beforeError = { code: error.code, message: error.message }; }
      const removed = join(root, 'removed-' + report.cases.length);
      writeFileSync(removed, 'owned'); unlinkSync(removed); entry.removalObserved = !existsSync(removed);
      try { fsyncSync(fd); entry.flushAfterRemoval = true; }
      catch (error) { entry.flushAfterRemoval = false; entry.afterError = { code: error.code, message: error.message }; }
    } catch (error) { entry.openError = { code: error.code, message: error.message }; }
    finally { if (fd !== undefined) closeSync(fd); }
    if (flags === 'r+') assert(entry.opened && entry.flushBefore && entry.flushAfterRemoval && entry.removalObserved,
      'The ordinary writable directory descriptor must actually flush');
  }
  report.completed = true;
} catch (error) {
  report.failure = { message: error.message, stack: error.stack }; process.exitCode = 1;
} finally {
  writeFileSync(output, JSON.stringify(report, null, 2)); rmSync(root, { recursive: true, force: true });
}
