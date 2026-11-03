import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { isVanishedSubdirectory } from '../../src/build/watch.ts';

let directory: string;
const failure = (code: string, scanned?: string) => Object.assign(new Error(code), { code, path: scanned });

beforeEach(() => { directory = fs.mkdtempSync(path.join(os.tmpdir(), 'apack-watch-vanished-')); });
afterEach(() => { fs.rmSync(directory, { recursive: true, force: true }); });

it('lets a directory below the watched one go away', () => {
  expect(isVanishedSubdirectory(failure('ENOENT', path.join(directory, '.apack/build/runtime')), directory)).toBe(true);
});

it('stops for the watched directory going away, by its own path or by no longer being there', () => {
  expect(isVanishedSubdirectory(failure('ENOENT', directory), directory)).toBe(false);
  const below = path.join(directory, 'gone');
  fs.rmSync(directory, { recursive: true });
  expect(isVanishedSubdirectory(failure('ENOENT', below), directory)).toBe(false);
});

it('stops for any other failure', () => {
  expect(isVanishedSubdirectory(failure('EMFILE', path.join(directory, 'a')), directory)).toBe(false);
  expect(isVanishedSubdirectory(failure('ENOENT'), directory)).toBe(false);
});
