// The loader's lines are what `@apackdev/testing` reads to tell whether a pack came up — the only signal a
// backend-only pack leaves. A reword has to be a change to both sides, not a pack author's suite failing
// later with the wrong reason, so the sentences live in one module and this pins that the loader uses it.
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { registry } from './test-host.ts';
import { PACK_LOAD_MESSAGES, packRegistered } from '../../../src/packs/load-messages.ts';
import { loadSingleExternalPack, registerExternalPacks } from '../../../src/packs/runtime/loader.ts';
import { PACK_LAYOUT } from '../../../src/packs/layout.ts';
import { PACK_SNAPSHOT_FORMAT } from '@apackdev/pack-format';
import { sealPack } from './build-fixture.ts';
import { testRootEvents } from '@apackdev/sdk/testing';

const PACK_ID = 'load-messages-pack';
let tmpDir: string;
let logged: string[];
let stopListening: () => void;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'load-messages-'));
  logged = [];
  stopListening = testRootEvents.onLog((event) => void logged.push(event.message));
});

afterEach(() => {
  stopListening();
  try { registry.unregisterPack(PACK_ID); } catch { /* not registered */ }
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('what the loader says about a pack', () => {
  it('registers with the sentence the harness watches for', () => {
    const manifest = { id: PACK_ID, name: PACK_ID, version: '1.0.0' };
    const pack = {
      registration: { id: PACK_ID },
      origin: { declarationRevision: 'fixture-revision', ...manifest, dir: tmpDir, manifest },
    };

    expect(registerExternalPacks(registry, [pack])).toHaveLength(1);

    expect(logged).toContain(packRegistered(PACK_ID, 0));
    // And the fragment the harness actually matches on is in it
    expect(logged.some((line) => line.startsWith(PACK_LOAD_MESSAGES.registered))).toBe(true);
  });

  // The E2E fixture installs a pack before the app it launches has ever run, so it can't check the pack's build
  // format against that app first — nothing outside the app knows which format it reads. It doesn't try: the app
  // decides, and this is how its decision reaches the fixture. Matched exactly as the fixture matches it.
  it('says a pack it will not load is not loaded, in the sentence the harness watches for', () => {
    const packDir = path.join(tmpDir, PACK_ID);
    const manifest = { id: PACK_ID, name: PACK_ID, version: '1.0.0' };
    // An installed pack as `apack pack install` leaves one, except that another apack built it
    fs.mkdirSync(path.join(packDir, PACK_LAYOUT.runtimeDir), { recursive: true });
    fs.mkdirSync(path.join(packDir, PACK_LAYOUT.typesDir), { recursive: true });
    fs.writeFileSync(path.join(packDir, PACK_LAYOUT.manifest), JSON.stringify(manifest));
    fs.writeFileSync(path.join(packDir, PACK_LAYOUT.runtimeEntry), 'module.exports = {};');
    fs.writeFileSync(path.join(packDir, PACK_LAYOUT.snapshot), JSON.stringify({ format: PACK_SNAPSHOT_FORMAT + 1 }));
    sealPack(packDir);

    const result = loadSingleExternalPack(registry, packDir);

    expect(result).toHaveProperty('problem');
    expect(result).toHaveProperty('problem', expect.stringContaining(`format ${PACK_SNAPSHOT_FORMAT + 1}`));
    const watched = new RegExp(`(${PACK_LOAD_MESSAGES.notLoaded.join('|')}) ${PACK_ID}\\b`);
    expect(logged.some((line) => watched.test(line))).toBe(true);
  });
});
