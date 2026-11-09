// @slow: two real builds prove compiled editor data publication and cached reuse.
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { packFixture } from '@apackdev/sdk/testing/pack-fixture';
import { PACK_LAYOUT, readInstalledContributionCatalog, readPackBuild, stagedFileHashes } from '@apackdev/host/packs';
import { readPackBuildInputs } from '@apackdev/host/build/pack-build-inputs';
import { packagesBuiltOrRefuse, REPO_ROOT } from '@apackdev/host/build/packages-built';
import { build } from '../../src/commands/build.ts';
import { cpuBudget } from '@apackdev/testing/vitest';

packagesBuiltOrRefuse('npm run packages:ensure');
let root: string;
afterEach(() => { if (root) fs.rmSync(root, { recursive: true, force: true }); });

it('publishes and reuses editor definitions without globals or frontend activation, readable from an installed copy without source', { meta: cpuBudget(2 * 60_000 + 20_000) }, async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'apack-dsl-snapshot-'));
  const author = path.join(root, 'author');
  packFixture({ at: author, manifest: { id: 'editor-data', name: 'Editor data', features: {},
    lifecycle: { onInit: 'src/lifecycle.ts#apply' },
    extensions: { dsl: { rows: { entry: 'src/rows.ts', targets: ['monaco'], prefix: 'row:' } } },
  }, files: { 'src/rows.ts': 'export interface Row { id: string }',
    'src/lifecycle.ts': 'throw new Error("Do not activate runtime"); export function apply() {}',
  }, nodeModules: path.join(REPO_ROOT, 'node_modules') });
  const cwd = process.cwd(); process.chdir(author);
  try {
    await build([]);
    const first = readPackBuild(path.join(author, 'dist'));
    expect(readPackBuildInputs(path.join(author, 'dist'), first.integrity).options).toEqual([]);
    expect(first.snapshot.dslDefinitions?.rows).toContain('interface Row');
    expect(first.snapshot.dslDefinitions?.rows).toContain('id: string');
    expect(fs.readFileSync(path.join(author, 'dist', PACK_LAYOUT.feEntry), 'utf8')).not.toContain('interface Row');
    const installedRoot = path.join(root, 'packs');
    fs.cpSync(path.join(author, 'dist'), path.join(installedRoot, 'editor-data'), { recursive: true });
    const catalog = readInstalledContributionCatalog(installedRoot, new Set(['editor-data']));
    expect(catalog.dsl()).toMatchObject([{ type: 'rows', packId: 'editor-data', enabled: false,
      definitions: first.snapshot.dslDefinitions!.rows, declaration: { prefix: 'row:' } }]);
    expect(fs.existsSync(path.join(installedRoot, 'editor-data/src'))).toBe(false);
    const log = vi.spyOn(console, 'log');
    try {
      await build(['--skip-generate']);
      expect(log.mock.calls.flat().join('\n')).toContain('dsl defs: unchanged, reused');
    } finally { log.mockRestore(); }
    const repeated = readPackBuild(path.join(author, 'dist'));
    expect(repeated.snapshot.dslDefinitions).toEqual(first.snapshot.dslDefinitions);
    expect(stagedFileHashes(repeated.integrity)).toEqual(stagedFileHashes(first.integrity));
    expect(readPackBuildInputs(path.join(author, 'dist'), repeated.integrity).options).toEqual(['--skip-generate']);
  } finally { process.chdir(cwd); }
});
