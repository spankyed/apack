import { eventContractsFixture } from './build-fixture.ts';
import { sealPack } from './build-fixture.ts';
import { _declarationRevision } from '@apackdev/pack-format';
/**
 * E2E test: exercises the real pack loading pipeline against an isolated
 * test data directory (resolved through @apackdev/sdk/env, never the user's
 * real app data). The test installs a fresh test pack, runs the full
 * boot-sequence functions, and verifies the system loads, registers, and
 * could serve surfaces to the FE (the packs.loaded entries).
 *
 * Cleans up after itself.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { registry } from './test-host.ts';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { loadExternalPacks } from '../../../src/packs/runtime/loader.ts';
import { getPacksWithClientLoadedFrontends } from '../../../src/packs/layout.ts';
import type { LoadedPack } from '../../../src/packs/runtime/loader.ts';
import { PACK_SNAPSHOT_FORMAT } from '@apackdev/pack-format';
import { _appDirOf } from '@apackdev/sdk/env';
import { PACK_LAYOUT } from '../../../src/packs/layout.ts';

/** A loaded pack's system, by feature id */
const systemOf = (pack: LoadedPack, featureId: string) => pack.registration.features?.[featureId]?.system;


const USER_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pack-e2e-'));
fs.mkdirSync(_appDirOf(USER_DATA_DIR), { recursive: true });
const TEST_PACK_ID = 'e2e-test-pack';
const TEST_PACK_DIR = path.join(_appDirOf(USER_DATA_DIR), 'packs', TEST_PACK_ID);

function installTestPack() {
  fs.mkdirSync(path.join(TEST_PACK_DIR, 'runtime'), { recursive: true });

  fs.writeFileSync(path.join(TEST_PACK_DIR, 'apack.json'), JSON.stringify({
    id: TEST_PACK_ID,
    name: 'E2E Test Pack',
    version: '1.0.0',
    features: {
      hello: { description: 'Feature declaration fixture.',
        system: {
          entry: 'src/features/hello/be/system.ts',
          events: { incoming: ['HELLO_PING'] },
        },
        surface: { label: 'Fixture', state: 'src/features/hello/fe/surface.ts' },
      },
      // No system — surface only
      dataOnly: { description: 'Feature declaration fixture.', surface: { label: 'Fixture', state: 'src/features/dataOnly/fe/surface.ts' } },
    },
  }, null, 2));

  fs.mkdirSync(path.join(TEST_PACK_DIR, 'types'), { recursive: true });
  fs.writeFileSync(path.join(TEST_PACK_DIR, PACK_LAYOUT.snapshot), JSON.stringify({ declarationRevision: _declarationRevision(JSON.parse(fs.readFileSync(path.join(TEST_PACK_DIR, 'apack.json'), 'utf-8'))), format: PACK_SNAPSHOT_FORMAT, manifest: JSON.parse(fs.readFileSync(path.join(TEST_PACK_DIR, 'apack.json'), 'utf-8')), eventContracts: eventContractsFixture(JSON.parse(fs.readFileSync(path.join(TEST_PACK_DIR, 'apack.json'), 'utf-8'))), types: { entities: {}, relKinds: {}, roles: {} }, entityDestinations: {}, facades: {} }));

  // The pack's frontend, which the renderer loads from the installed pack
  fs.writeFileSync(path.join(TEST_PACK_DIR, 'runtime', 'fe.js'), 'export default { surfaces: [] };');

  // A real runtime registration whose system machine requires xstate from the host
  fs.writeFileSync(path.join(TEST_PACK_DIR, 'runtime', 'index.cjs'), (`
    'use strict';
    const { setup } = require('xstate');

    const helloMachine = setup({
      types: {
        events: {},
      },
    }).createMachine({
      id: 'e2e-hello',
      initial: 'idle',
      states: {
        idle: {
          on: {
            CLIENT_CONNECTED: {
              actions: () => {},
            },
            HELLO_PING: {
              actions: () => {},
            },
          },
        },
      },
    });

    module.exports = {
      registration: {
        id: '${TEST_PACK_ID}',
        features: {
          // As apack pack build writes it: the machine's events and the manifest's incoming ones
          hello: { system: { machine: helloMachine, receives: ['CLIENT_CONNECTED', 'HELLO_PING'] }, surface: { receives: [] } },
          dataOnly: { surface: { receives: [] } },
        },
      },
    };
  `) + `
if (module.exports.registration) module.exports.registration.declarationRevision = '${_declarationRevision(JSON.parse(fs.readFileSync(path.join(TEST_PACK_DIR, 'apack.json'), 'utf-8')))}';`);
  sealPack(TEST_PACK_DIR);
}

function cleanupTestPack() {
  if (fs.existsSync(TEST_PACK_DIR)) {
    fs.rmSync(TEST_PACK_DIR, { recursive: true, force: true });
  }
}

let origEnv: { env?: string; userDataDir?: string };

beforeAll(() => {
  origEnv = { env: process.env.APACK_ENV, userDataDir: process.env.APACK_USER_DATA_DIR };
  process.env.APACK_ENV = 'test';
  process.env.APACK_USER_DATA_DIR = USER_DATA_DIR;
  installTestPack();
});

afterAll(() => {
  cleanupTestPack();
  fs.rmSync(USER_DATA_DIR, { recursive: true, force: true });
  for (const [key, value] of [['APACK_ENV', origEnv.env], ['APACK_USER_DATA_DIR', origEnv.userDataDir]] as const) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe('E2E: pack loading pipeline', () => {
  let packs: LoadedPack[];

  it('discovers the test pack from the resolved packs directory', () => {
    packs = loadExternalPacks(registry);
    const testPack = packs.find(p => p.origin.id === TEST_PACK_ID);
    expect(testPack).toBeDefined();
    expect(testPack!.origin.name).toBe('E2E Test Pack');
    expect(testPack!.origin.version).toBe('1.0.0');
    expect(testPack!.origin.dir).toBe(TEST_PACK_DIR);
  });

  it('loads the runtime registration via Module._resolveFilename override', () => {
    const testPack = packs.find(p => p.origin.id === TEST_PACK_ID)!;
    expect(systemOf(testPack, 'hello')).toBeDefined();

    const system = systemOf(testPack, 'hello');
    expect(system?.machine).toBeDefined();
    expect(system?.machine.id).toBe('e2e-hello');
  });

  it('registers no system for a feature that has only a surface', () => {
    const testPack = packs.find(p => p.origin.id === TEST_PACK_ID)!;
    expect(systemOf(testPack, 'dataOnly')).toBeUndefined();
  });

  it('lists the pack as one whose frontend a client loads', () => {
    const testPack = packs.find(p => p.origin.id === TEST_PACK_ID)!;
    const loaded = { loadedPacks: () => [testPack.origin], getPackRuntime: () => ({ origin: testPack.origin, registrationId: 'runtime' }) };

    expect(getPacksWithClientLoadedFrontends(loaded)).toEqual([TEST_PACK_ID]);
  });

  it('xstate machine from pack is functional (can create states)', () => {
    const testPack = packs.find(p => p.origin.id === TEST_PACK_ID)!;
    const machine = systemOf(testPack, 'hello')!.machine;

    // Verify the machine has the expected structure
    expect(machine.config.initial).toBe('idle');
    expect(machine.config.states).toHaveProperty('idle');
    expect(machine.config.states!.idle.on).toHaveProperty('CLIENT_CONNECTED');
    expect(machine.config.states!.idle.on).toHaveProperty('HELLO_PING');
  });
});
