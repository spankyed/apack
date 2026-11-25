import { sealPack } from './build-fixture.ts';
import { _declarationRevision } from '@apackdev/pack-format';
// A pack declares which event types each of its surfaces receives, and the bus checks every send against
// that declaration. It reaches the app on the registration the pack's runtime bundle exports, so what this
// pins is that loading a pack doesn't lose it: a surface with no declaration is read as one whose pack was
// built before declarations existed, and then nothing is checked at all — silently, for the packs the app
// controls least.
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { registry } from './test-host.ts';
import { loadExternalPacks, registerExternalPacks } from '../../../src/packs/runtime/loader.ts';
import { SURFACE_EVENT_TYPES } from '@apackdev/sdk/events';
import { PACK_SNAPSHOT_FORMAT } from '@apackdev/pack-format';
import { _appDirOf } from '@apackdev/sdk/env';
import { PACK_LAYOUT } from '../../../src/packs/layout.ts';

/** The events a pack's surface receives: what its pack declares, and what the app sends every surface */
const receives = (...types: string[]) => new Set([...types, ...SURFACE_EVENT_TYPES]);

const PACK_ID = 'declaring-pack';
const RECEIVED = ['MEMOS_CONNECTED', 'MEMO_ADDED'];

let tmpDir: string;
let origEnv: { env?: string; userDataDir?: string };

/** An installed pack with one surface feature, declaring what that surface receives — what `apack pack build` emits */
function installDeclaringPack(received: string[]) {
  const packDir = path.join(_appDirOf(tmpDir), 'packs', PACK_ID);
  fs.mkdirSync(path.join(packDir, 'runtime'), { recursive: true });
  fs.writeFileSync(path.join(packDir, 'apack.json'), JSON.stringify({
    id: PACK_ID, name: 'Declaring Pack', version: '1.0.0',
    features: { memos: { description: 'Feature declaration fixture.', surface: { label: 'Fixture', state: 'fe/surface.ts' } } },
  }));
  fs.mkdirSync(path.join(packDir, 'types'), { recursive: true });
  fs.writeFileSync(path.join(packDir, PACK_LAYOUT.snapshot), JSON.stringify({ declarationRevision: _declarationRevision(JSON.parse(fs.readFileSync(path.join(packDir, 'apack.json'), 'utf-8'))), format: PACK_SNAPSHOT_FORMAT, manifest: JSON.parse(fs.readFileSync(path.join(packDir, 'apack.json'), 'utf-8')), types: { entities: {}, relKinds: {}, roles: {} }, entityDestinations: {}, eventContracts: { memos: { surface: { receives: received } } }, facades: {} }));
  fs.writeFileSync(path.join(packDir, 'runtime', 'index.cjs'), (`module.exports = { registration: ${JSON.stringify({
    id: PACK_ID,
    features: { memos: { surface: { receives: received } } },
  })} };`) + `
if (module.exports.registration) module.exports.registration.declarationRevision = '${_declarationRevision(JSON.parse(fs.readFileSync(path.join(packDir, 'apack.json'), 'utf-8')))}';`);
  fs.writeFileSync(path.join(packDir, 'runtime', 'fe.js'), 'export default {};');
  sealPack(packDir);
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pack-declarations-'));
  origEnv = { env: process.env.APACK_ENV, userDataDir: process.env.APACK_USER_DATA_DIR };
  process.env.APACK_ENV = 'test';
  process.env.APACK_USER_DATA_DIR = tmpDir;
});

afterEach(() => {
  try { registry.unregisterPack(PACK_ID); } catch { /* not registered */ }
  for (const [key, value] of [['APACK_ENV', origEnv.env], ['APACK_USER_DATA_DIR', origEnv.userDataDir]] as const) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// Where a pack came from is the app's knowledge, not the pack's: a pack's own generated registration can
// see neither its `apack.json` nor the directory it was installed into. The registry keeps it beside the
// registration so both come and go together.
describe('where the registry says a pack came from', () => {
  it('records an external pack\'s manifest and directory, and drops them when it unregisters', () => {
    installDeclaringPack(RECEIVED);

    expect(registerExternalPacks(registry, loadExternalPacks(registry))).toHaveLength(1);

    const origin = registry.packOrigin(PACK_ID);
    expect(origin).toMatchObject({ id: PACK_ID, name: 'Declaring Pack', version: '1.0.0' });
    expect(origin?.dir).toBe(path.join(_appDirOf(tmpDir), 'packs', PACK_ID));
    expect(origin?.manifest?.id).toBe(PACK_ID);
    expect(registry.loadedPacks().map((o) => o.id)).toContain(PACK_ID);
    expect(registry.packOrigin(PACK_ID)?.buildRevision).toMatch(/^[a-f0-9]{64}$/);

    registry.unregisterPack(PACK_ID);
    expect(registry.packOrigin(PACK_ID)).toBeNull();
    expect(registry.loadedPacks().map((o) => o.id)).not.toContain(PACK_ID);
  });
});

describe('the event types an external pack declares for its surfaces', () => {
  it('reach the validation map the bus checks sends against', () => {
    installDeclaringPack(RECEIVED);

    expect(registerExternalPacks(registry, loadExternalPacks(registry))).toHaveLength(1);

    expect(registry.getSurfaceEventValidationMap().get(`${PACK_ID}/memos`)).toEqual(receives(...RECEIVED));
  });
});
