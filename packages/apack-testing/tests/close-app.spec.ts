import { EventEmitter } from 'node:events';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { ElectronApplication } from '@playwright/test';
import { afterEach, describe, expect, it } from 'vitest';
import { closeApp } from '../src/index.ts';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'close-app-'));
  dirs.push(dir);
  return dir;
}

describe('closeApp()', () => {
  it('captures app.process() before app.close() so tearing down Playwright handles never throws', async () => {
    const proc = Object.assign(new EventEmitter(), {
      pid: undefined as number | undefined,
      exitCode: null as number | null,
      signalCode: null as NodeJS.Signals | null,
      stdout: new EventEmitter(),
      stderr: new EventEmitter(),
      kill: () => true,
    });
    let closed = false;
    const app = {
      process() {
        if (closed) throw new TypeError("Cannot read properties of undefined (reading '_object')");
        return proc;
      },
      async evaluate() { return []; },
      async close() {
        closed = true;
        proc.exitCode = 0;
        proc.emit('close', 0, null);
      },
    } as unknown as ElectronApplication;

    await expect(closeApp(app, { userDataDir: tempDir(), keepProfile: true })).resolves.toBeUndefined();
  });

  it('resolves when Electron has already exited before closeApp() attaches its close listener', async () => {
    const proc = Object.assign(new EventEmitter(), {
      pid: undefined as number | undefined,
      exitCode: 0 as number | null,
      signalCode: null as NodeJS.Signals | null,
      stdout: new EventEmitter(),
      stderr: new EventEmitter(),
      kill: () => true,
    });
    const app = {
      process: () => proc,
      async evaluate() { return []; },
      close: () => new Promise<void>(() => {}), // never settles — `gone` must resolve immediately
    } as unknown as ElectronApplication;

    await expect(closeApp(app, { userDataDir: tempDir(), keepProfile: true })).resolves.toBeUndefined();
  });

  it('handles Playwright already clearing its internal process handle before closeApp() is called', async () => {
    const app = {
      process() {
        throw new TypeError("Cannot read properties of undefined (reading '_object')");
      },
      async evaluate() { return []; },
      async close() {},
    } as unknown as ElectronApplication;

    await expect(closeApp(app, { userDataDir: tempDir(), keepProfile: true })).resolves.toBeUndefined();
  });
});
