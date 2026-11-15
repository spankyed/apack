// The key a data dir's terminal broker proves itself with (`brokerKey`).
import { mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { brokerKey } from '../../src/services/terminal.ts';

let directory: string | undefined;
afterEach(() => {
  if (directory) rmSync(directory, { recursive: true, force: true });
  directory = undefined;
});
const appDir = () => (directory = mkdtempSync(path.join(tmpdir(), 'terminal-key-')));

describe("a data dir's terminal broker key", () => {
  /**
   * **The same key every time it is asked for**, because a kept session's broker outlives the app that started
   * it, and the next app has to ask that broker for proof of the key it was started with.
   */
  it('is made the first time it is asked for, and is that key from then on', () => {
    const dir = appDir();
    const first = brokerKey(dir);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(brokerKey(dir)).toBe(first);
    // Nothing is left of how it was made
    expect(readdirSync(dir)).toEqual(['terminal-key']);
  });

  it('is readable by its user alone', () => {
    if (process.platform === 'win32') return;
    const dir = appDir();
    brokerKey(dir);
    expect(statSync(path.join(dir, 'terminal-key')).mode & 0o777).toBe(0o600);
  });

  /** One that is there and is not a key is refused rather than replaced: a running broker holds the one it had */
  it('refuses a file there that is not a key, naming it', () => {
    const dir = appDir();
    writeFileSync(path.join(dir, 'terminal-key'), 'not a key');
    expect(() => brokerKey(dir)).toThrow(/terminal-key does not hold a terminal broker key/);
  });
});
