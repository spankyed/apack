// The API prints each log event once, whether it comes from @apackdev/sdk/logger, an error report or a console call,
// and every one of them reaches the log event stream
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'api-log-capture-'));
process.env.APACK_ENV = 'test';
process.env.APACK_USER_DATA_DIR = dataDir;
const { openAppStore } = await import('../../src/runtime/index.ts');
const { database: store } = openAppStore();
const { createLogger, reportError } = await import('@apackdev/sdk/logger');
const { rootEvents } = await import('../../src/transport/emitter.ts');
const { originalConsole, initializeLogCapture, restoreConsole } = await import('../../src/adapters/logging.ts');

afterAll(() => {
  store.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe('log capture', () => {
  it('prints each log event once, and emits one event per entry', () => {
    const printed = (['log', 'debug', 'warn', 'error'] as const).map((method) => vi.spyOn(originalConsole, method).mockImplementation(() => {}));
    const logged: Array<{ level: string; message: string; source?: string }> = [];
    const stop = rootEvents.onLog((event) => { logged.push(event); });
    initializeLogCapture();
    try {
      createLogger('spec').info('from the logger', { id: 1 });
      console.warn('from the console', 2);
      console.log('logged');
      reportError({ error: new Error('boom'), source: 'spec' });
    } finally {
      restoreConsole();
      stop();
    }
    const [log, debug, warn, error] = printed.map((spy) => spy.mock.calls);
    vi.restoreAllMocks();

    expect({ log: log.length, warn: warn.length, error: error.length, debug: debug.length })
      .toEqual({ log: 2, warn: 1, error: 1, debug: 0 });
    expect(logged.map(({ level, message, source }) => ({ level, message, source }))).toEqual([
      { level: 'info', message: 'from the logger', source: 'spec' },
      { level: 'warn', message: 'from the console 2', source: undefined },
      { level: 'info', message: 'logged', source: undefined },
      { level: 'error', message: 'boom', source: 'spec' },
    ]);
  });
});
