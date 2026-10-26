// apack.json is a feature's only config: `apack pack add feature` writes its designation there, and `apack pack validate`
// checks the manifest's `features` against the pack on disk
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { init } from '../../src/commands/init';
import { addFeature } from '../../src/commands/add/feature';
import { validate } from '../../src/commands/validate';
import { PACK_LAYOUT } from '@apackdev/host/packs';

let tmp: string;
let pack: string;
let template: string;
const origCwd = process.cwd();

// One scaffold for the file; every test mutates its own copy of it
beforeAll(async () => {
  template = fs.mkdtempSync(path.join(os.tmpdir(), 'apack-add-feature-template-'));
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  process.chdir(template);
  try {
    await init(['demo-pack']);
  } finally {
    process.chdir(origCwd);
    log.mockRestore();
  }
});

afterAll(() => {
  if (template) fs.rmSync(template, { recursive: true, force: true });
});

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'apack-add-feature-'));
  vi.spyOn(console, 'log').mockImplementation(() => {});
  pack = path.join(tmp, 'demo-pack');
  fs.cpSync(path.join(template, 'demo-pack'), pack, { recursive: true, verbatimSymlinks: true });
});

afterEach(async () => {
  process.chdir(origCwd);
  vi.restoreAllMocks();
  fs.rmSync(tmp, { recursive: true, force: true });
  // Receive runner replies between synchronous generation/validation scenarios.
  await new Promise<void>(resolve => setImmediate(resolve));
});

const readManifest = () => JSON.parse(fs.readFileSync(path.join(pack, 'apack.json'), 'utf-8'));

/**
 * The workspace's modules, so the pack resolves `@apackdev/sdk` as an installed one does. A surface's contract names
 * `SurfaceInbox`, and validation runs code generation, which can't read an inbox whose type didn't resolve.
 */
function installDependencies() {
  const link = path.join(pack, 'node_modules');
  if (!fs.existsSync(link)) fs.symlinkSync(path.resolve(import.meta.dirname, '../../../../node_modules'), link, 'dir');
}

async function runValidate(): Promise<{ exitCode: number | undefined; output: string }> {
  const log = vi.mocked(console.log);
  log.mockClear();
  const exit = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    throw Object.assign(new Error('exit'), { exitCode: code });
  }) as never);
  process.chdir(pack);
  let exitCode: number | undefined;
  try {
    await validate([]);
  } catch (err: any) {
    if (err.exitCode === undefined) throw err;
    exitCode = err.exitCode;
  } finally {
    process.chdir(origCwd);
    exit.mockRestore();
  }
  return { exitCode, output: log.mock.calls.map(args => args.join(' ')).join('\n') };
}

describe('apack pack add feature', () => {
  it.each([{ options: [] }, { options: ['--description', ''] }, { options: ['--description', '--icon', 'Box'] }])
    ('requires a purpose before writing feature files ($options)', async ({ options }) => {
      await expect(addFeature(['memos', ...options], pack)).rejects.toThrow('--description <purpose>');
      expect(fs.existsSync(path.join(pack, 'src', 'features', 'memos'))).toBe(false);
      expect(JSON.parse(fs.readFileSync(path.join(pack, 'apack.json'), 'utf8')).features).toEqual({});
    });
  // Pack code names features and the host addresses them, so what the scaffold writes never holds an address
  it('writes a feature whose code names it and never holds its address', async () => {
    await addFeature(['memos', '--description', 'Manage memos.'], pack);
    const feature = path.join(pack, 'src', 'features', 'memos');
    const sources = ['fe/state.ts', 'be/system.ts'].map((file) => fs.readFileSync(path.join(feature, file), 'utf-8')).join('\n');
    expect(sources).not.toMatch(/busId|system-ids|demo-pack\./);
    expect(fs.readFileSync(path.join(feature, 'fe', 'state.ts'), 'utf-8')).toContain("export const id = 'memos';");
    expect(fs.existsSync(path.join(feature, 'fe', 'surface.ts'))).toBe(false);
    expect(JSON.parse(fs.readFileSync(path.join(pack, 'apack.json'), 'utf8')).features.memos.surface).toMatchObject({ label: 'Memos', state: 'src/features/memos/fe/state.ts', canvas: 'src/features/memos/fe/canvas/list.vue' });
  });

  // A surface's contract declares its inbox with `SurfaceInbox`, so reading one takes the pack's @apackdev/sdk. Without
  // it the type collapses to `any`, which has no properties — codegen used to read that as an inbox open to nothing
  // and generate a pack whose surface silently received none of what it declares. It stops and says so now, and
  // `init` puts `npm install` before `apack pack add feature` for exactly this reason.
  it("keeps the scaffold of a pack whose dependencies aren't installed, and says npm install regenerates", async () => {
    await addFeature(['memos', '--description', 'Manage memos.'], pack);

    expect(fs.existsSync(path.join(pack, 'src', 'features', 'memos', 'be', 'system.ts'))).toBe(true);
    const output = vi.mocked(console.log).mock.calls.map((args) => args.join(' ')).join('\n');
    expect(output).toMatch(/src\/__generated__\/ not regenerated: .*resolves to `any`.*Run: npm install/);
    expect(output).not.toContain('__generated__/ regenerated');
  });

  it('writes --designation into apack.json', async () => {
    installDependencies();
    await addFeature(['memos', '--description', 'Manage memos.', '--designation', 'memos'], pack);

    expect(readManifest().features).toEqual({ memos: expect.objectContaining({ designation: 'memos' }) });
    expect((await runValidate()).exitCode).toBeUndefined();
  });

  // A designation is a role, not a name. The CLI refused one that differed from the feature name, which
  // `validate` has always accepted and the manifest schema has always allowed.
  it('writes a designation that differs from the feature name', async () => {
    installDependencies();
    await addFeature(['memos', '--description', 'Manage memos.', '--designation', 'inbox'], pack);

    expect(readManifest().features).toEqual({ memos: expect.objectContaining({ designation: 'inbox' }) });
    expect((await runValidate()).exitCode).toBeUndefined();
  });
});

describe('apack pack validate', () => {
  it("reports a feature's invalid settings default, and accepts a designation that is not its id", async () => {
    await addFeature(['memos', '--description', 'Manage memos.'], pack);
    const manifest = readManifest();
    // A role that is not the feature's id, which is the half of this case's title that the fixture has to show
    manifest.features.memos.designation = 'inbox';
    fs.writeFileSync(path.join(pack, 'apack.json'), JSON.stringify(manifest, null, 2));
    manifest.features.memos.settings.defaults = { unexpected: true };
    fs.writeFileSync(path.join(pack, 'apack.json'), JSON.stringify(manifest, null, 2));

    const { exitCode, output } = await runValidate();

    expect(exitCode).toBe(1);
    expect(output).toContain('features.memos.settings.defaults.unexpected');
    expect(output).not.toContain('designation');
  });

  it('reports malformed dependency data as incomplete validation', async () => {
    const dependency = path.join(tmp, 'malformed-pack');
    fs.mkdirSync(path.join(dependency, 'dist', 'types'), { recursive: true });
    fs.writeFileSync(path.join(dependency, 'dist', PACK_LAYOUT.snapshot), JSON.stringify({
      types: { entities: {}, relKinds: {}, roles: {} }, entityDestinations: {}, facades: {}, manifest: { id: 'malformed-pack', version: '1.0.0' },
    }));
    const manifest = readManifest();
    manifest.dependencies = { 'malformed-pack': `file:${dependency}` };
    fs.writeFileSync(path.join(pack, 'apack.json'), JSON.stringify(manifest, null, 2));

    const { exitCode, output } = await runValidate();

    expect(output).toContain('Warnings:');
    expect(output).toContain('snapshot.json declarationRevision: Invalid input: expected string, received undefined');
    expect(output).toContain('snapshot.json manifest.name: Invalid input: expected string, received undefined');
    expect(exitCode).toBe(2);
    expect(output).toContain('Validation incomplete');
    expect(output).not.toContain('Pack is valid');
  });

  describe('content sources (the checks code generation makes)', () => {
    const DEFAULT_SETUP = path.resolve(import.meta.dirname, '../../../default-setup');
    function editManifest(edit: (manifest: any) => void) {
      const manifest = readManifest();
      edit(manifest);
      fs.writeFileSync(path.join(pack, 'apack.json'), JSON.stringify(manifest, null, 2));
    }

    it('reports a format entity no pack declares', async () => {
      editManifest((manifest) => {
        manifest.content!.formats = { ...manifest.content!.formats, memos: { format: 'markdown-tree', entity: 'Memo', identity: ['title'] } };
      });

      const { exitCode, output } = await runValidate();

      expect(exitCode).toBe(1);
      expect(output).toContain(`Content format "memos": entity "Memo" isn't declared by this pack, its dependencies or the SDK`);
    });

    it("reports a format a dependency doesn't have", async () => {
      editManifest((manifest) => {
        manifest.dependencies = { 'default-setup': `file:${DEFAULT_SETUP}` };
        manifest.content = { ...manifest.content, sources: { ...manifest.content?.sources, memos: { path: 'src/content/memos', format: 'default-setup:nope' } } };
      });

      const { exitCode, output } = await runValidate();

      expect(exitCode).toBe(1);
      expect(output).toContain('Content "memos": dependency "default-setup" has no format "nope"');
    });

    it('reports a content writer module without the named export', async () => {
      fs.mkdirSync(path.join(pack, 'src', 'content'), { recursive: true });
      fs.writeFileSync(path.join(pack, 'src', 'content', 'writers.ts'), 'export const otherWriter = {};\n');
      editManifest((manifest) => {
        manifest.data = { ...manifest.data, entities: { ...manifest.data?.entities, Memo: {} } };
        manifest.content = { ...manifest.content, writers: { Memo: 'src/content/writers.ts#memoWriter' } };
      });

      const { exitCode, output } = await runValidate();

      expect(exitCode).toBe(1);
      expect(output).toContain(`A content writer for "Memo": src/content/writers.ts doesn't export "memoWriter"`);
    });

    it('passes a pack whose content sources check out', async () => {
      expect((await runValidate()).exitCode).toBeUndefined();
    });
  });
});
