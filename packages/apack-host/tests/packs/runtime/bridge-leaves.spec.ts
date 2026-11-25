import { sealPack } from './build-fixture.ts';
import { _declarationRevision } from '@apackdev/pack-format';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { registry } from './test-host.ts';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { PACK_SNAPSHOT_FORMAT } from '@apackdev/pack-format';
import { PACK_LAYOUT } from '../../../src/packs/layout.ts';

/**
 * An installed pack's runtime has no node_modules: every @apackdev/sdk subpath it requires must come
 * from the host's bridge, including import-free leaves like cron and compare-versions.
 */
let packDir: string;
let fixtureRoot: string;
beforeEach(() => {
  // Outside the repo, so plain Node resolution can't find @apackdev/sdk
  fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-leaves-'));
  packDir = path.join(fixtureRoot, 'bridge-leaves');
  fs.mkdirSync(packDir);
});
afterEach(() => {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
});

describe('external pack runtime', () => {
  it('requires @apackdev/sdk/cron and @apackdev/sdk/utils/compare-versions through the bridge', async () => {
    fs.writeFileSync(path.join(packDir, 'apack.json'), JSON.stringify({ id: 'bridge-leaves', name: 'Bridge', version: '1.0.0', extensions: { services: { leaves: 'leaves.ts#leaves' } } }));
    fs.mkdirSync(path.join(packDir, 'types'), { recursive: true });
    fs.writeFileSync(path.join(packDir, PACK_LAYOUT.snapshot), JSON.stringify({ declarationRevision: _declarationRevision(JSON.parse(fs.readFileSync(path.join(packDir, 'apack.json'), 'utf-8'))), format: PACK_SNAPSHOT_FORMAT, manifest: JSON.parse(fs.readFileSync(path.join(packDir, 'apack.json'), 'utf-8')), types: { entities: {}, relKinds: {}, roles: {} }, entityDestinations: {}, facades: {} }));
    fs.mkdirSync(path.join(packDir, 'runtime'));
    fs.writeFileSync(path.join(packDir, 'runtime', 'index.cjs'), (`
      const { cronToHuman } = require('@apackdev/sdk/cron');
      const { compareVersions } = require('@apackdev/sdk/utils/compare-versions');
      exports.registration = { id: 'bridge-leaves', services: { leaves: { cron: cronToHuman('0 * * * *'), newer: compareVersions('1.1.0', '1.0.0') } } };
    `) + `
if (module.exports.registration) module.exports.registration.declarationRevision = '${_declarationRevision(JSON.parse(fs.readFileSync(path.join(packDir, 'apack.json'), 'utf-8')))}';`);
    sealPack(packDir);
    const { loadSingleExternalPack } = await import('../../../src/packs/runtime/loader.ts');

    const pack = loadSingleExternalPack(registry, packDir);

    if ('problem' in pack) throw new Error(pack.problem);
    expect(pack.registration.services).toEqual({ leaves: { cron: expect.any(String), newer: 1 } });
  });

  /**
   * The require that is not made during the load. esbuild defers a module's body into an `__init` the
   * bundle calls on first use, so default-setup's `extensions/steps/action/runtime.ts` requires
   * `@apackdev/sdk/logger` when an action step first runs. A resolution scoped to the load is gone by then,
   * and applying the require cache cannot cover it, because Node resolves before it reads the cache.
   *
   * It is invisible in a checkout: the workspace `node_modules` above a pack answers the bare specifier.
   * This pack is in a temp dir, which is what an installed one is, so nothing answers but the host.
   */
  it('requires one lazily, after the load that produced it has returned', async () => {
    fs.writeFileSync(path.join(packDir, 'apack.json'), JSON.stringify({ id: 'bridge-leaves', name: 'Lazy', version: '1.0.0', extensions: { services: { step: 'step.ts#step' } } }));
    fs.mkdirSync(path.join(packDir, 'types'), { recursive: true });
    fs.writeFileSync(path.join(packDir, PACK_LAYOUT.snapshot), JSON.stringify({ declarationRevision: _declarationRevision(JSON.parse(fs.readFileSync(path.join(packDir, 'apack.json'), 'utf-8'))), format: PACK_SNAPSHOT_FORMAT, manifest: JSON.parse(fs.readFileSync(path.join(packDir, 'apack.json'), 'utf-8')), types: { entities: {}, relKinds: {}, roles: {} }, entityDestinations: {}, facades: {} }));
    fs.mkdirSync(path.join(packDir, 'runtime'));
    fs.writeFileSync(path.join(packDir, 'runtime', 'index.cjs'), (`
      exports.registration = { id: 'bridge-leaves', services: { step: { run: () => typeof require('@apackdev/sdk/logger').createLogger } } };
    `) + `
if (module.exports.registration) module.exports.registration.declarationRevision = '${_declarationRevision(JSON.parse(fs.readFileSync(path.join(packDir, 'apack.json'), 'utf-8')))}';`);
    sealPack(packDir);
    const { loadSingleExternalPack } = await import('../../../src/packs/runtime/loader.ts');

    const pack = loadSingleExternalPack(registry, packDir);

    if ('problem' in pack) throw new Error(pack.problem);
    const step = (pack.registration.services as { step: { run: () => string } }).step;
    // Outside the load: the call happens here, with no bridge on the stack
    expect(step.run()).toBe('function');
  });
});
