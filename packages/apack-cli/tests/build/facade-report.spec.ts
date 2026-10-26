// What a facade bundle normalises to, and what the committed report says about it.
//
// The normalisation is the whole reason the report exists: `tsc` emits a bundle whose statement order and
// import order are its own business, so a report taken from one verbatim would differ from itself. Every case
// below writes its fixture bundle deliberately **out of** report order — which is why these cases are here
// rather than driven through `apack pack facade-report`: that command derives its bundle from a pack's sources
// now, and no pack can be asked to emit its declarations in the wrong order on purpose.
//
// The command's own spec is `tests/commands/facade-report.integration.spec.ts`, over a real pack.
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PACK_SNAPSHOT_FORMAT, PACK_TYPES_FACADE, _declarationRevision } from '@apackdev/sdk/build';
import { PACK_LAYOUT, sealPackBuild } from '@apackdev/host/packs';
import { createPackCompilerInputView } from '@apackdev/host/build/compiler-inputs';
import { readPackageInputs } from '@apackdev/host/build/package-inputs';
import { writePackBuildInputs } from '@apackdev/host/build/pack-build-inputs';
import { compareFacadeReport, facadeReportFile, facadeReportText, readBuiltFacadeReport } from '../../src/build/facade-report';

import { facadeReport } from '../../src/commands/facade-report.ts';

const PACK = '/packs/demo';

/** The order declarations appear in the report body, which is what the normalisation decides */
const order = (text: string, names: readonly string[]): string[] =>
  names.map((name) => ({ name, at: text.indexOf(name) })).filter((e) => e.at >= 0).sort((a, b) => a.at - b.at).map((e) => e.name);

describe('facadeReportText', () => {
  /**
   * The property the report exists for: a bundle whose statements arrive in any order produces one canonical
   * report. Written with the declarations reversed and the export list first, so a run that merely copied the
   * bundle through would fail this rather than pass it by luck.
   */
  it('puts imports first, then declarations by name, then the export list', () => {
    const report = facadeReportText([
      'export { Zeta, Alpha };',
      'declare type Zeta = 1;',
      "import type { b, a } from 'x';",
      'declare type Alpha = 2;',
    ].join('\n'), PACK, 'demo');

    expect(order(report, ['import type', 'Alpha', 'Zeta', 'export {'])).toEqual(['import type', 'Alpha', 'Zeta', 'export {']);
  });

  it("sorts an import's names, so `{ b, a }` and `{ a, b }` give one report", () => {
    expect(facadeReportText("import type { b, a } from 'x';\ndeclare type T = 1;\n", PACK, 'demo'))
      .toContain("import type { a, b } from 'x';");
  });

  it('names the pack it reports on', () => {
    expect(facadeReportText('declare type T = 1;\n', PACK, 'demo')).toContain('Facade types report for the "demo" pack');
  });

  it("shortens the pack's own path, which is one machine's and not part of the facade", () => {
    const report = facadeReportText(`declare const at: '${PACK}/src/thing.ts';\n`, PACK, 'demo');
    expect(report).toContain("'./src/thing.ts'");
    expect(report).not.toContain(PACK);
  });

  /**
   * The label the bundle is parsed under is this module's to compute, so the command's temp path and the
   * build's `dist` path cannot reach the report between them. Two callers passing different paths is exactly
   * the divergence that would be invisible until a report moved for no reason.
   */
  it('reads the same for one bundle however it reached here', () => {
    const bundle = "import type { b, a } from 'x';\nexport { T };\ndeclare type T = 1;\n";
    expect(facadeReportText(bundle, PACK, 'demo')).toBe(facadeReportText(bundle, PACK, 'demo'));
  });
});

describe('compareFacadeReport', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'facade-report-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const record = (text: string) => {
    fs.mkdirSync(path.dirname(facadeReportFile(dir)), { recursive: true });
    fs.writeFileSync(facadeReportFile(dir), text);
  };

  it('finds a report that matches current, with nothing to say about it', () => {
    const next = facadeReportText('declare type T = 1;\n', dir, 'demo');
    record(next);
    expect(compareFacadeReport(dir, next)).toEqual({ state: 'current' });
  });

  it('ignores reordered inferred properties but detects changed types and overload order', () => {
    const report = (body: string) => facadeReportText(body, dir, 'demo');
    record(report('type T = { hidden?: boolean; phases?: { name: string; color?: string }[]; disabled?: boolean };'));
    expect(compareFacadeReport(dir, report('type T = { disabled?: boolean; hidden?: boolean; phases?: { color?: string; name: string }[] };')).state).toBe('current');
    expect(compareFacadeReport(dir, report('type T = { disabled?: string; hidden?: boolean; phases?: { color?: string; name: string }[] };')).state).toBe('stale');
    record(report('type T = { (value: string): number; (value: unknown): string };'));
    expect(compareFacadeReport(dir, report('type T = { (value: unknown): string; (value: string): number };')).state).toBe('stale');
  });

  it('compares optional literal unions consistently without hiding contract or comment changes', () => {
    const header = '## Facade types report\n\n```ts\n';
    const report = (body: string) => header + body + '\n```\n';
    record(report('type T = { copyState?: "error" | "idle" | "pending" | "saved" | undefined; readonly id: string };'));
    expect(compareFacadeReport(dir, report('type T = { readonly id: string; copyState?: "error" | "pending" | "idle" | "saved" | undefined };')).state).toBe('current');
    for (const mutation of [
      'copyState?: "error" | "idle" | "pending" | undefined; readonly id: string',
      'copyState?: "error" | "idle" | "pending" | "saved" | "new" | undefined; readonly id: string',
      'copyState: "error" | "idle" | "pending" | "saved" | undefined; readonly id: string',
      'copyState?: "error" | "idle" | "pending" | "saved" | undefined; id: string',
    ]) expect(compareFacadeReport(dir, report(`type T = { ${mutation} };`)).state).toBe('stale');
    record(report('type T = "b" | /* explanation */ "a" | undefined;'));
    expect(compareFacadeReport(dir, report('type T = "b" | /* changed */ "a" | undefined;')).state).toBe('stale');
    record(report('type T = Foo | Bar | undefined;'));
    expect(compareFacadeReport(dir, report('type T = Bar | Foo | undefined;')).state).toBe('stale');
  });

  /** Missing and stale are different answers, and only one of them is a diff */
  it('reports a missing report as missing rather than as a difference', () => {
    const comparison = compareFacadeReport(dir, 'anything');
    expect(comparison.state).toBe('missing');
    expect(comparison.problem).toContain("doesn't exist");
    expect(comparison.problem).toContain('facade:update');
  });

  it('reports a report that no longer matches as stale, and names the fix', () => {
    record('## Facade types report for the "demo" pack\n\nstale\n');
    const comparison = compareFacadeReport(dir, facadeReportText('declare type T = 1;\n', dir, 'demo'));
    expect(comparison.state).toBe('stale');
    expect(comparison.problem).toContain('differs');
    expect(comparison.problem).toContain('facade:update');
  });
});


describe('readBuiltFacadeReport', () => {
  let root: string;
  beforeEach(() => {
    root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'built-facade-report-')));
    const manifest = { id: 'report-pack', name: 'Report', version: '1.0.0' };
    fs.writeFileSync(path.join(root, 'apack.json'), JSON.stringify(manifest));
    fs.mkdirSync(path.join(root, 'src/__generated__'), { recursive: true });
    fs.writeFileSync(path.join(root, 'src/types.ts'), 'export interface Memo { title: string }');
    fs.writeFileSync(path.join(root, 'src/__generated__/pack-types.ts'), "export type { Memo } from '../types.ts';");
    fs.mkdirSync(path.dirname(facadeReportFile(root)), { recursive: true });
    fs.writeFileSync(facadeReportFile(root), facadeReportText('export interface Memo { title: string }', root, manifest.id));
    const view = createPackCompilerInputView(root);
    view.readBytes(path.join(root, 'src/types.ts'));
    view.readDataBytes(path.join(root, 'src/__generated__/pack-types.ts'));
    view.captureDataLocation(path.join(root, 'src/__generated__'), 'directory');
    view.captureLocation(path.join(root, 'src/__generated__'), 'entries');
    const observations = view.observations().entries;
    view.dispose();
    const directory = path.join(root, 'dist');
    fs.mkdirSync(path.join(directory, 'types'), { recursive: true });
    fs.mkdirSync(path.join(directory, 'runtime'));
    fs.writeFileSync(path.join(directory, PACK_LAYOUT.runtimeEntry), 'throw new Error("Report activated runtime");');
    fs.writeFileSync(path.join(directory, PACK_LAYOUT.snapshot), JSON.stringify({
      manifest, declarationRevision: _declarationRevision(manifest), format: PACK_SNAPSHOT_FORMAT,
      types: { entities: {}, relKinds: {}, roles: {} }, entityDestinations: {},
      facades: { [PACK_TYPES_FACADE]: 'export interface Memo { title: string }' },
    }));
    writePackBuildInputs(directory, { compiler: 'a'.repeat(64), execution: 'b'.repeat(64), options: [], observations,
      packages: { hash: readPackageInputs([{ id: 'pack', directory: root }], { dependencyContents: 'resolution' }).hash,
        owners: [{ id: 'pack', directory: '' }], discovered: [] } });
    sealPackBuild(directory, manifest);
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it('reads the verified facade without activating the runtime or changing generated entries', () => {
    const directory = path.join(root, 'src/__generated__');
    const before = fs.readdirSync(directory);
    const stat = fs.statSync(path.join(directory, 'pack-types.ts'));
    expect(readBuiltFacadeReport(root)).toContain('interface Memo');
    expect(fs.readdirSync(directory)).toEqual(before);
    expect(fs.statSync(path.join(directory, 'pack-types.ts')).mtimeMs).toBe(stat.mtimeMs);
  });

  it('checks through the built CLI path and refuses options that would regenerate inputs', async () => {
    const cwd = vi.spyOn(process, 'cwd').mockReturnValue(root);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      await facadeReport(['--from-build']);
      expect(log).toHaveBeenLastCalledWith('etc/pack-types.api.md is up to date');
      await expect(facadeReport(['--from-build', '--skip-generate'])).rejects.toThrow('Usage:');
      await expect(facadeReport(['--from-build', '--update'])).rejects.toThrow('Usage:');
    } finally { cwd.mockRestore(); log.mockRestore(); }
  });

  it.each(['src/types.ts', 'src/__generated__/pack-types.ts', 'src/__generated__/.generating.lock'])(
    'refuses changed %s instead of regenerating or accepting the old build', file => {
      fs.appendFileSync(path.join(root, file), '\n// changed');
      expect(() => readBuiltFacadeReport(root)).toThrow(/input changed|package inputs changed/);
    },
  );

  it('refuses modified output against its sealed receipt', () => {
    fs.appendFileSync(path.join(root, 'dist', PACK_LAYOUT.snapshot), ' ');
    expect(() => readBuiltFacadeReport(root)).toThrow(/verification/);
  });
});
