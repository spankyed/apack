import { buildStagingDir } from '../../src/build/build-publication.ts';
// @slow: five real builds verify staged DSL publication, failure retention, reuse and removal.
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { packFixture } from '@apackdev/sdk/testing/pack-fixture';
import { build } from '../../src/commands/build';
import { PACK_LAYOUT, readPackBuild, stagedFileHashes } from '@apackdev/host/packs';
import { readPackBuildInputs } from '@apackdev/host/build/pack-build-inputs';
import { packagesBuiltOrRefuse, REPO_ROOT } from '@apackdev/host/build/packages-built';
import { cpuBudget } from '@apackdev/testing/vitest';

packagesBuiltOrRefuse('npm run packages:ensure');
let root: string;
afterEach(() => { if (root) fs.rmSync(root, { recursive: true, force: true }); });

describe('staged DSL definitions', () => {
  it('preserves a verified build on a later failure, then publishes and reuses the current definitions with its frontend', { meta: cpuBudget(5 * 60_000 + 20_000) }, async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'apack-staged-dsl-'));
    const dir = path.join(root, 'dist');
    fs.mkdirSync(dir);
    packFixture({ at: root, manifest: {
      id: 'staged-dsl', name: 'Staged DSL', features: {}, lifecycle: { onInit: 'src/lifecycle.ts#apply' },
      extensions: { dsl: { rows: { entry: 'src/rows.ts', targets: ['monaco'], prefix: '', globals: { row: 'Row' } } } },
    }, files: { 'src/rows.ts': 'export interface Row { before: true }', 'src/lifecycle.ts': 'export function apply() {}' }, nodeModules: path.join(REPO_ROOT, 'node_modules') });
    const cwd = process.cwd();
    process.chdir(root);
    try {
      await build([]);
      const first = readPackBuild(dir);
      const definitions = path.join(dir, 'defs/monaco/rows-defs.d.ts');
      const original = fs.readFileSync(definitions, 'utf8');
      expect(original).toContain('before: true');
      expect(first.snapshot.dslDefinitions).toEqual({ rows: original });
      expect(fs.readFileSync(path.join(dir, PACK_LAYOUT.feEntry), 'utf8')).not.toContain('before: true');
      const reads = fs.readFileSync(path.join(root, '.apack/reads.json'), 'utf8');
      const cache = fs.readFileSync(path.join(dir, 'phase-cache.json'), 'utf8');
      fs.writeFileSync(path.join(root, 'src/rows.ts'), 'export interface Row { after: true }');
      const lifecycle = path.join(root, 'src/lifecycle.ts');
      fs.writeFileSync(lifecycle, 'import "./missing-runtime.ts"; export function apply() {}');
      await expect(build([])).rejects.toThrow('Runtime bundle failed');
      expect(readPackBuild(dir).revision).toBe(first.revision);
      expect(fs.readFileSync(definitions, 'utf8')).toBe(original);
      expect(fs.readFileSync(path.join(root, '.apack/reads.json'), 'utf8')).toBe(reads);
      expect(fs.readFileSync(path.join(dir, 'phase-cache.json'), 'utf8')).toBe(cache);
      expect(fs.existsSync(buildStagingDir(root))).toBe(false);
      fs.writeFileSync(lifecycle, 'export function apply() {}');
      await build([]);
      const current = readPackBuild(dir);
      expect(readPackBuildInputs(dir, current.integrity).options).toEqual([]);
      expect(current.revision).not.toBe(first.revision);
      expect(current.snapshot.dslDefinitions?.rows).toContain('after: true');
      expect(fs.readFileSync(definitions, 'utf8')).toContain('after: true');
      const frontend = fs.readFileSync(path.join(dir, PACK_LAYOUT.feEntry), 'utf8');
      expect(frontend).not.toContain('after: true');
      expect(frontend).not.toContain('before: true');
      const log = vi.spyOn(console, 'log');
      try {
        await build(['--skip-generate']);
        expect(log.mock.calls.flat().join('\n')).toContain('dsl defs: unchanged, reused');
        expect(log.mock.calls.flat().join('\n')).toContain('fe: dist/runtime/fe.js');
      } finally { log.mockRestore(); }
      const reused = readPackBuild(dir);
      expect(stagedFileHashes(reused.integrity)).toEqual(stagedFileHashes(current.integrity));
      expect(readPackBuildInputs(dir, reused.integrity).options).toEqual(['--skip-generate']);
      const manifestFile = path.join(root, 'apack.json');
      const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
      delete manifest.extensions.dsl;
      fs.writeFileSync(manifestFile, JSON.stringify(manifest));
      await build([]);
      expect(readPackBuild(dir).snapshot.manifest.extensions?.dsl).toBeUndefined();
      expect(readPackBuild(dir).snapshot.dslDefinitions).toBeUndefined();
      expect(fs.existsSync(definitions)).toBe(false);
      expect(fs.readFileSync(path.join(dir, PACK_LAYOUT.feEntry), 'utf8')).not.toContain('after: true');
    } finally { process.chdir(cwd); }
  });
});
