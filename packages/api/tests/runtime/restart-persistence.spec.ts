// The app's data survives a restart: the store the API's composition opens (openAppStore) persists the
// engine's writes, and a store opened again reads them
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'api-restart-persistence-'));
process.env.APACK_ENV = 'test';
process.env.APACK_USER_DATA_DIR = dataDir;
const { openAppStore } = await import('../../src/runtime/index.ts');
const { untypedCreate, untypedQuery } = await import('@apackdev/sdk/ears');
const { _getLmdbPath } = await import('@apackdev/sdk/utils');
const { unbindHost } = await import('@apackdev/sdk/runtime/internals');

afterAll(() => fs.rmSync(dataDir, { recursive: true, force: true }));

describe('the API store across a restart', () => {
  it('reads what the previous run committed', async () => {
    const first = openAppStore();
    expect(_getLmdbPath().startsWith(dataDir)).toBe(true);
    untypedCreate('Prompt', { id: 'Prompt-restart', label: 'written before the restart', inputs: {}, templateFn: 'return ""' });
    first.store.close();
    // A new process starts with nothing bound, and a new engine
    unbindHost();

    const second = openAppStore();
    try {
      expect(second.engine).not.toBe(first.engine);
      // The engine reads the files, so what the first run committed is there as the store opens
      expect(untypedQuery.withTrashed('Prompt').ids()).toEqual(['Prompt-restart']);
      expect(second.engine.getRow('Prompt-restart')?.label).toBe('written before the restart');
    } finally {
      second.store.close();
    }
  });
});
