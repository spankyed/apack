import fs from 'node:fs';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { readPeLoaderMetadata } from '../../src/build/compiler-pe-environment.ts';
import { PE_HELPER_TIMEOUT_MS } from '../../src/build/compiler-pe-activation.ts';

const query = vi.hoisted(() => vi.fn());
vi.mock('node:child_process', () => ({ execFileSync: query }));

const library = 'C:\\capture\\' + 'nësted\\'.repeat(30) + 'value.dll';
const metadata = { libraries: [library], safeSearch: true, devOverride: false, knownDlls: ['kernel32.dll'] };
beforeEach(() => {
  query.mockReset().mockReturnValue(JSON.stringify(metadata));
  vi.spyOn(fs, 'statSync').mockReturnValue({ isFile: () => true } as fs.Stats);
});
afterEach(() => vi.restoreAllMocks());

it('retains full module paths from the bounded OS query', () => {
  expect(library.length).toBeGreaterThan(130);
  expect(readPeLoaderMetadata('C:\\Windows\\System32', 123)).toEqual(metadata);
  expect(query).toHaveBeenCalledWith('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
    ['-NoProfile', '-NonInteractive', '-File', expect.stringMatching(/\\bin\\compiler-pe-process\.ps1$/)],
    expect.objectContaining({ input: JSON.stringify({ pid: 123, environment: false }), timeout: PE_HELPER_TIMEOUT_MS, windowsHide: true }));
});

it('refuses module paths that identify a directory instead of a complete image filename', () => {
  vi.mocked(fs.statSync).mockReturnValue({ isFile: () => false } as fs.Stats);
  expect(() => readPeLoaderMetadata('C:\\Windows\\System32')).toThrow('invalid OS metadata');
});

it('does not expose subprocess output through a metadata refusal', () => {
  query.mockImplementation(() => { throw Object.assign(new Error('command failed with private stdout'), { stdout: 'private stdout', code: 'EPERM' }); });
  expect(() => readPeLoaderMetadata('C:\\Windows\\System32')).toThrow('Cannot read Windows compiler loader policy: EPERM');
});

it('refuses an invalid process id before constructing an OS command', () => {
  expect(() => readPeLoaderMetadata('C:\\Windows\\System32', -1)).toThrow('positive process id');
  expect(query).not.toHaveBeenCalled();
});
