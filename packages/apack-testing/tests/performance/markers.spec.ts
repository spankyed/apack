import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, expect, it, vi } from 'vitest';
import { publishPerformanceMarker } from '../../src/performance/markers.ts';

const directories: string[] = [];
afterEach(() => { vi.restoreAllMocks(); syncBuiltinESMExports(); for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true }); });
function destination() {
  const directory = fs.mkdtempSync(path.join(tmpdir(), 'apack-marker-')); directories.push(directory);
  return path.join(directory, 'ready.json');
}
it('keeps the handshake invisible to a peer between file creation and the JSON write', () => {
  const file = destination(); const observed: Array<string | undefined> = [];
  const write = fs.writeFileSync;
  const partial = vi.spyOn(fs, 'writeFileSync').mockImplementation((target, value, options) => {
    write(target, '', options);
    // A peer can run after open(O_CREAT), before write, even though the publisher uses sync I/O.
    observed.push(fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : undefined);
    write(target, value, { flag: 'w' });
  });
  syncBuiltinESMExports();
  publishPerformanceMarker(file, { index: 0, mode: 'lightweight' });
  partial.mockRestore(); syncBuiltinESMExports();
  expect(observed).toEqual([undefined]);
  expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual({ index: 0, mode: 'lightweight' });
  expect(() => publishPerformanceMarker(file, { index: 1 })).toThrow(/already published/);
  expect(JSON.parse(fs.readFileSync(file, 'utf8')).index).toBe(0);
  expect(fs.readdirSync(path.dirname(file))).toEqual(['ready.json']);
});
it('leaves no visible or partial marker when publication fails', () => {
  const file = destination();
  vi.spyOn(fs, 'renameSync').mockImplementation(() => { throw Error('publication refused'); });
  syncBuiltinESMExports();
  expect(() => publishPerformanceMarker(file, { index: 0 })).toThrow(/publication refused/);
  expect(fs.readdirSync(path.dirname(file))).toEqual([]);
});
