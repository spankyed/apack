import { expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { _appDataPaths } from '@apackdev/sdk/utils';
import { performanceStorageFormat } from '../../../tests/performance/storage-identity.ts';
import { performanceQualificationCommand, performanceQualificationOptions, performanceRevisionOptions } from '../../../scripts/lib/performance-qualification.ts';
it('selects all four scenarios, declared trials and two different modes', () => {
  const options = performanceQualificationOptions(['--scenario', 'all'], '/checkout', 123);
  expect(options.scenarios).toEqual(['thread-open', 'search', 'streaming', 'populated-startup']);
  expect(options.mode).not.toBe(options.comparison);
  for (const args of [['--scenario', 'other'], ['--trials', '1'], ['--trials', '3'], ['--trials', '102'], ['--mode', 'lightweight'], ['--compare', 'other']]) {
    expect(() => performanceQualificationOptions(args, '/checkout')).toThrow();
  }
});
it('runs the actual scenario or startup controller and owns its output and environment', () => {
  const options = performanceQualificationOptions([], '/checkout', 123);
  const command = performanceQualificationCommand('thread-open', '/owned', options, { DISPLAY: ':12', APACK_PERFORMANCE_STARTUP: 'stale', APACK_PERFORMANCE_OUTPUT: 'stale' });
  expect(command.args).toContain('playwright');
  expect(command.env).toMatchObject({ DISPLAY: ':12', APACK_PERFORMANCE_RUN_OUTPUT: '/owned', APACK_PERFORMANCE_MODE: options.mode, APACK_PERFORMANCE_COMPARE_MODE: options.comparison, APACK_PERFORMANCE_TRIALS: String(options.measured) });
  expect(command.env.APACK_PERFORMANCE_STARTUP).toBeUndefined();
  expect(command.env.APACK_PERFORMANCE_OUTPUT).toBeUndefined();
  expect(performanceQualificationCommand('populated-startup', '/owned', options, {}).args).toContain('tests/performance/startup-run.ts');
  expect(() => performanceQualificationCommand('thread-open', '/owned', options, { E2E_DATA_DIR: '/developer' })).toThrow(/disposable/);
});

it('requires explicit revision checkouts and uses independent worker output without nested mode comparison', () => {
  const options = performanceRevisionOptions(['--baseline', 'before', '--candidate', 'after', '--scenario', 'all'], '/checkout', 123);
  expect(options.roots.A).not.toBe(options.roots.B);
  const command = performanceQualificationCommand('search', '/owned/B', { mode: 'lightweight', measured: 20 }, { APACK_PERFORMANCE_COMPARE_MODE: 'detailed', APACK_PERFORMANCE_GATE: 'stale' });
  expect(command.env.APACK_PERFORMANCE_COMPARE_MODE).toBeUndefined();
  expect(command.env.APACK_PERFORMANCE_GATE).toBeUndefined();
  for (const args of [[], ['--baseline', 'before'], ['--baseline', 'before', '--candidate', 'after', '--trials', '3']]) expect(() => performanceRevisionOptions(args, '/checkout')).toThrow();
});

it('requires both actual store markers and persisted SQLite identity before labeling application measurements', () => {
  const profile = mkdtempSync(path.join(tmpdir(), 'apack-e2e-performance-'));
  const stores = _appDataPaths(profile), directories = [stores.lmdb, stores.runHistory];
  const header = Buffer.alloc(100); header.write('SQLite format 3\0'); header.writeUInt32BE(1, 60); header.writeUInt32BE(0x45415253, 68);
  try {
    expect(() => performanceStorageFormat('/developer/profile', 'sqlite/1')).toThrow(/disposable/);
    for (const directory of directories) { mkdirSync(directory, { recursive: true }); writeFileSync(path.join(directory, 'data.mdb'), Buffer.alloc(4096)); }
    expect(performanceStorageFormat(profile, 'elmdb/1')).toBe('elmdb/1');
    expect(() => performanceStorageFormat(profile, 'sqlite/1')).toThrow();
    rmSync(path.join(directories[0]!, 'data.mdb')); writeFileSync(path.join(directories[0]!, 'data.sqlite3'), header);
    expect(() => performanceStorageFormat(profile, 'sqlite/1')).toThrow();
    rmSync(path.join(directories[1]!, 'data.mdb')); writeFileSync(path.join(directories[1]!, 'data.sqlite3'), header);
    expect(performanceStorageFormat(profile, 'sqlite/1')).toBe('sqlite/1');
    expect(() => performanceStorageFormat(profile, 'elmdb/1')).toThrow();
    const foreign = Buffer.from(header); foreign.writeUInt32BE(0, 68); writeFileSync(path.join(directories[1]!, 'data.sqlite3'), foreign);
    expect(() => performanceStorageFormat(profile, 'sqlite/1')).toThrow(/persisted EARS/);
  } finally { rmSync(profile, { recursive: true, force: true }); }
});
