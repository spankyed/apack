import { _declarationRevision } from '@apackdev/pack-format';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generatePackFiles, PACK_TYPES_FACADE } from '@apackdev/pack-build';
import { PACK_SNAPSHOT_FORMAT, type PackManifest, type PackSnapshot } from '@apackdev/pack-format';
import { bundlePackTypes } from '../../src/build/types-bundler';
import { warnStaleDepTypes } from '../../src/commands/generate-entries';

let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'dep-types-version-'));
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
  vi.restoreAllMocks();
});

/** Writes the facade types generation produces for base-pack at `version` */
async function generateDepTypes(version: string): Promise<void> {
  const manifest = { id: 'app-pack', name: 'App', version: '1.0.0' } as PackManifest;
  const baseManifest: PackManifest = { id: 'base-pack', name: 'Base', version };
  const baseRoot = path.join(root, 'base');
  fs.mkdirSync(baseRoot);
  fs.symlinkSync(path.resolve(__dirname, '../../../..', 'node_modules'), path.join(root, 'node_modules'), 'dir');
  for (const [file, content] of Object.entries(await generatePackFiles(baseManifest, { packRoot: baseRoot }))) {
    const target = path.join(baseRoot, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
  const bundled = await bundlePackTypes(baseRoot, path.join(baseRoot, 'pack-types.d.ts'));
  if (!bundled.success) throw new Error(bundled.error);
  const snapshot: PackSnapshot = { declarationRevision: _declarationRevision(baseManifest),
    types: { entities: {}, relKinds: {}, roles: {} }, entityDestinations: {}, facades: { [PACK_TYPES_FACADE]: bundled.content }, manifest: baseManifest, format: PACK_SNAPSHOT_FORMAT };
  for (const [file, content] of Object.entries(await generatePackFiles(manifest, { packRoot: root, depSnapshots: new Map([['base-pack', snapshot]]) }))) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), content);
  }
}

describe('warnStaleDepTypes', () => {
  it('warns when the dependency the pack builds with is not the version its facade types came from', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await generateDepTypes('1.2.0');

    warnStaleDepTypes(root, new Map([['base-pack', '1.2.0']]));
    expect(warn).not.toHaveBeenCalled();

    warnStaleDepTypes(root, new Map([['base-pack', '1.3.0']]));
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/base-pack@1\.2\.0[\s\S]*builds with base-pack@1\.3\.0/));
  });

  it('skips a dependency without facade types', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    warnStaleDepTypes(root, new Map([['base-pack', '1.0.0']]));
    expect(warn).not.toHaveBeenCalled();
  });
});
