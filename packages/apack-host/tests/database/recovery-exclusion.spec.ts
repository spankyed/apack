import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { EarsDatabase } from '@apackdev/ears';
import { databaseStorage } from '../../src/database/storage.ts';
import { holdRecoveryExclusion, openProfileDatabase } from '../../src/database/recovery-lock.ts';

const roots: string[] = [], opened: EarsDatabase[] = [];
afterEach(() => { for (const db of opened.splice(0)) db.close(); for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
function fixture(format: string) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'apack-store-exclusion-')); roots.push(root);
  const primary = path.join(root, 'lmdb'), history = path.join(root, 'run-history');
  const open = (dir: string, readOnly = false) => {
    const db = openProfileDatabase(dir, readOnly, () => databaseStorage(format).open({ path: dir, readOnly }));
    opened.push(db); return db;
  };
  return { root, primary, history, open };
}

describe.each(['elmdb/1', 'sqlite/1'])('store exclusion (%s)', format => {
  it.each([false, true])('permits a verified unrelated primary handle when history is absent (readOnly=%s)', readOnly => {
    const f = fixture(format); f.open(f.primary).close(); f.open(f.primary, readOnly);
    const lock = holdRecoveryExclusion(f.history, 'store');
    try { expect(() => f.open(f.history)).toThrow('Wait for import recovery'); expect(fs.existsSync(f.history)).toBe(false); }
    finally { lock.release(); }
    f.open(f.history);
  });
  it.each([false, true])('refuses an existing history handle and releases failed exclusion (readOnly=%s)', readOnly => {
    const f = fixture(format); f.open(f.primary); f.open(f.history).close(); const held = f.open(f.history, readOnly);
    expect(() => holdRecoveryExclusion(f.history, 'store')).toThrow('Close apps and tools');
    expect(fs.existsSync(path.join(f.root, 'db-recovery.lock'))).toBe(false);
    held.close(); holdRecoveryExclusion(f.history, 'store').release();
  });
  it.each(['unknown', 'stale identity', 'target name'])('refuses %s claims even when history is absent', kind => {
    const f = fixture(format); f.open(f.primary);
    const dir = path.join(f.root, 'db-readers'), file = path.join(dir, fs.readdirSync(dir)[0]);
    const claim = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (kind === 'unknown') delete claim.directory;
    if (kind === 'stale identity') claim.directory = '999999:123456789';
    if (kind === 'target name') claim.database = 'run-history';
    fs.writeFileSync(file, JSON.stringify(claim));
    expect(() => holdRecoveryExclusion(f.history, 'store')).toThrow('Close apps and tools');
    expect(fs.existsSync(f.history)).toBe(false);
  });
  it('keeps profile exclusion broader than store exclusion', () => {
    const f = fixture(format); f.open(f.primary);
    expect(() => holdRecoveryExclusion(f.history)).toThrow('Close apps and tools');
  });
});
