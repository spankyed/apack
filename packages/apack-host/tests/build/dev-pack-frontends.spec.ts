// Which packs a dev server serves frontends from source for, and the module its renderer imports to reach
// them. Serving from source is the whole of what the dev server adds — in a built app every pack's frontend
// is fetched over `pack://` — so what this checks is that the set is decided by what is on disk and by
// nothing about the pack's kind.
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { REPO_ROOT } from '../../src/build/packages-built.ts';
import { devPackFrontendsModule, discoverDevPackFrontends } from '../../src/build/discover.ts';

let tmp: string;
beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-pack-frontends-')); });
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

/** A pack dir, with a generated frontend entry when `withFe` */
function writePack(parent: string, id: string, withFe: boolean, manifest: Record<string, unknown> = {}): string {
  const dir = path.join(parent, id);
  fs.mkdirSync(path.join(dir, 'src', '__generated__'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'apack.json'), JSON.stringify({ id, name: id, version: '1.0.0', ...manifest }));
  if (withFe) fs.writeFileSync(path.join(dir, 'src', '__generated__', 'pack-entry-fe.ts'), 'export default {};');
  return dir;
}

const warnings: string[] = [];
beforeEach(() => { warnings.length = 0; });
const warn = (message: string) => { warnings.push(message); };

const idsOf = (packagesRoot: string, extra?: string, cwd = tmp) =>
  discoverDevPackFrontends(packagesRoot, extra, cwd, warn).map((pack) => pack.id);

describe('the packs a dev server serves from source', () => {
  it('takes a pack whether or not it is one the app ships', () => {
    const packages = path.join(tmp, 'packages');
    writePack(packages, 'shipped', true);
    writePack(packages, 'installed', true);

    expect(idsOf(packages).sort()).toEqual(['installed', 'shipped']);
  });

  // Codegen writes the entry; without it there is no module to import, and `pack://` is what serves the pack
  it('leaves out a pack whose codegen has written no frontend entry', () => {
    const packages = path.join(tmp, 'packages');
    writePack(packages, 'has-fe', true);
    writePack(packages, 'no-fe', false);

    expect(idsOf(packages)).toEqual(['has-fe']);
  });

  it('leaves out a directory that is not a pack', () => {
    const packages = path.join(tmp, 'packages');
    writePack(packages, 'a-pack', true);
    fs.mkdirSync(path.join(packages, 'not-a-pack', 'src', '__generated__'), { recursive: true });
    fs.writeFileSync(path.join(packages, 'not-a-pack', 'src', '__generated__', 'pack-entry-fe.ts'), 'export default {};');

    expect(idsOf(packages)).toEqual(['a-pack']);
  });

  // This is how a pack outside the workspace joins the loop — `tests/packs/*` among them, which is what the
  // devex requirement is checked against
  it('takes the directories APACK_DEV_PACK_DIRS names, relative to the cwd, separated by : or ,', () => {
    const packages = path.join(tmp, 'packages');
    writePack(packages, 'workspace-pack', true);
    writePack(path.join(tmp, 'fixtures'), 'outside-one', true);
    writePack(path.join(tmp, 'fixtures'), 'outside-two', true);

    expect(idsOf(packages, 'fixtures/outside-one,fixtures/outside-two').sort())
      .toEqual(['outside-one', 'outside-two', 'workspace-pack']);
    expect(idsOf(packages, 'fixtures/outside-one:fixtures/outside-two').sort())
      .toEqual(['outside-one', 'outside-two', 'workspace-pack']);
  });

  it('keeps one entry per pack id when a directory is named twice', () => {
    const packages = path.join(tmp, 'packages');
    writePack(packages, 'twice', true);

    expect(idsOf(packages, 'packages/twice')).toEqual(['twice']);
  });

  it('does not serve the released starter as local workspace source', () => {
    const found = discoverDevPackFrontends(path.join(REPO_ROOT, 'packages'), undefined, REPO_ROOT, warn);

    expect(found.map((pack) => pack.id)).not.toContain('default-setup');
    expect(warnings).toEqual([]);
  });

  it('reports no packs, quietly, when the root it scans does not exist', () => {
    expect(idsOf(path.join(tmp, 'no-such-dir'), undefined)).toEqual([]);
    expect(warnings).toEqual([]);
  });

  // The other half: asked for by name and yielding nothing, which is a typo the author has to be told about
  it('says why a directory it was named does not count', () => {
    const packages = path.join(tmp, 'packages');
    writePack(packages, 'fine', true);
    writePack(path.join(tmp, 'fixtures'), 'unbuilt', false);

    expect(idsOf(packages, 'fixtures/unbuilt,fixtures/absent')).toEqual(['fine']);
    expect(warnings.join('\n')).toMatch(/fixtures\/unbuilt, which has no .*pack-entry-fe\.ts/);
    expect(warnings.join('\n')).toMatch(/fixtures\/absent, which has no apack\.json/);
  });
});

describe('the module the renderer imports them through', () => {
  it('imports each pack by the absolute path of its entry, so the dev server resolves it', () => {
    const module = devPackFrontendsModule([
      { id: 'default-setup', feEntry: '/packages/default-setup/src/__generated__/pack-entry-fe.ts' },
      { id: 'memo-pack', feEntry: '/elsewhere/memo-pack/src/__generated__/pack-entry-fe.ts' },
    ]);

    expect(module).toBe([
      'export default {',
      '  "default-setup": () => import("/packages/default-setup/src/__generated__/pack-entry-fe.ts"),',
      '  "memo-pack": () => import("/elsewhere/memo-pack/src/__generated__/pack-entry-fe.ts"),',
      '};',
      '',
    ].join('\n'));
  });

  // A production build serves no source, and the module still has to resolve: main.ts imports it either way
  it('is an empty map rather than nothing when no pack is served from source', () => {
    expect(devPackFrontendsModule([])).toBe('export default {\n\n};\n');
  });
});
