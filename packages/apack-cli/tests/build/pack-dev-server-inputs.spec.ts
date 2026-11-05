// What a pack's dev server treats as its inputs: what changing means restarting it
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { readPackDevServerInputs } from '../../src/build/fe-bundler.ts';

const roots: string[] = [];
afterEach(() => {
  vi.unstubAllEnvs();
  roots.splice(0).forEach(root => fs.rmSync(root, { recursive: true, force: true }));
});

function packDirectory(): string {
  const pack = fs.mkdtempSync(path.join(os.tmpdir(), 'apack-dev-server-inputs-'));
  roots.push(pack);
  fs.writeFileSync(path.join(pack, 'apack.json'), JSON.stringify({ id: 'builder', name: 'Builder', version: '1.0.0' }));
  return pack;
}

it('tracks frontend SDK and UI metadata while leaving bundled EARS outside the shared frontend inputs', () => {
  const pack = packDirectory();
  const metadata = (name: string, description: string) => {
    const directory = path.join(pack, 'node_modules', name);
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, 'package.json'), JSON.stringify({ name, description, exports: {} }));
  };
  for (const name of ['@apackdev/sdk', '@apackdev/ui', '@apackdev/ears']) metadata(name, 'original');
  const before = readPackDevServerInputs(pack);
  metadata('@apackdev/ears', 'changed');
  expect(readPackDevServerInputs(pack)).toBe(before);
  metadata('@apackdev/sdk', 'changed');
  const sdkChanged = readPackDevServerInputs(pack);
  expect(sdkChanged).not.toBe(before);
  metadata('@apackdev/ui', 'changed');
  expect(readPackDevServerInputs(pack)).not.toBe(sdkChanged);
});

it('tracks effective ordered frontend Node options without treating source-mode flags as runtime changes', () => {
  const pack = packDirectory();
  vi.stubEnv('NODE_OPTIONS', '--require one.cjs --import two.mjs');
  const first = readPackDevServerInputs(pack);
  vi.stubEnv('NODE_OPTIONS', '--require "one.cjs"   --import two.mjs --conditions=@apackdev/source');
  expect(readPackDevServerInputs(pack)).toBe(first);
  vi.stubEnv('NODE_OPTIONS', '--import two.mjs --require one.cjs');
  expect(readPackDevServerInputs(pack)).not.toBe(first);
  vi.stubEnv('NODE_OPTIONS', '--require other.cjs --import two.mjs');
  expect(readPackDevServerInputs(pack)).not.toBe(first);
});
