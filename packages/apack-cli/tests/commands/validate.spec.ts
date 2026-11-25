import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { _declarationRevision } from '@apackdev/pack-format';
import { generatePackFiles } from '@apackdev/pack-build';
import { inspectDependencies } from '../../src/build/dependency-inspection.ts';
import { validate, validatePack } from '../../src/commands/validate';

vi.mock('../../src/build/dependency-inspection.ts', () => ({ inspectDependencies: vi.fn() }));
vi.mock('@apackdev/pack-build', async importOriginal => ({
  ...await importOriginal<typeof import('@apackdev/pack-build')>(), generatePackFiles: vi.fn(),
}));

let root: string;
const manifest = { id: 'demo', name: 'Demo', version: '1.0.0' };
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'apack-validation-'));
  fs.writeFileSync(path.join(root, 'apack.json'), JSON.stringify(manifest));
  vi.mocked(inspectDependencies).mockResolvedValue({ entries: [], files: new Map() });
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
  vi.restoreAllMocks();
  vi.resetAllMocks();
});

describe('pack authoring validation', () => {
  it('reports failed dependency resolution as incomplete, without running codegen or creating output', async () => {
    vi.mocked(inspectDependencies).mockResolvedValue({ entries: [{ id: 'base', spec: '*', status: 'unavailable', problem: 'Unresolved dependency base' }], files: new Map() });
    const before = fs.readdirSync(root);
    const report = await validatePack(root);
    expect(report).toMatchObject({
      status: 'incomplete', diagnostics: [{ code: 'dependency.unresolved', severity: 'warning', packId: 'demo', path: ['dependencies'] }],
      skippedChecks: [{ check: 'dependencies' }, { check: 'codegen' }],
    });
    expect(generatePackFiles).not.toHaveBeenCalled();
    expect(inspectDependencies).toHaveBeenCalledWith(root, undefined);
    expect(fs.readdirSync(root)).toEqual(before);
  });

  it('checks consumed service ownership even when own sources are missing and another dependency is unavailable', async () => {
    const declaration = { ...manifest, dependencies: { provider: '*', other: '*' },
      consumes: { services: ['provider/search'] }, extensions: { services: { own: 'missing.ts#own' } } };
    fs.writeFileSync(path.join(root, 'apack.json'), JSON.stringify(declaration));
    const provider = { id: 'provider', name: 'Provider', version: '1.0.0' };
    vi.mocked(inspectDependencies).mockResolvedValue({ entries: [
      { id: 'provider', spec: '*', status: 'resolved' }, { id: 'other', spec: '*', status: 'unavailable', problem: 'Offline' },
    ], files: new Map([['provider', { directory: '/missing', kind: 'type-data', revision: 'test', snapshot: {
      manifest: provider, declarationRevision: _declarationRevision(provider),
      types: { entities: {}, relKinds: {}, roles: {} }, entityDestinations: {}, facades: {},
    } }]]) });
    const report = await validatePack(root);
    expect(report.status).toBe('invalid');
    expect(report.diagnostics).toContainEqual(expect.objectContaining({ code: 'consumed-services.invalid',
      message: 'Pack "demo" consumes "provider/search", but provider "provider" does not declare service "search"' }));
    expect(generatePackFiles).not.toHaveBeenCalled();
    expect(fs.readdirSync(root)).toEqual(['apack.json']);
  });

  it('reports unavailable consumed declarations as incomplete rather than an invalid API', async () => {
    fs.writeFileSync(path.join(root, 'apack.json'), JSON.stringify({ ...manifest,
      dependencies: { provider: '*' }, consumes: { services: ['provider/search'] } }));
    vi.mocked(inspectDependencies).mockResolvedValue({ entries: [
      { id: 'provider', spec: '*', status: 'unavailable', problem: 'Offline' },
    ], files: new Map() });
    const report = await validatePack(root);
    expect(report.status).toBe('incomplete');
    expect(report.skippedChecks).toContainEqual(expect.objectContaining({ check: 'consumed-services' }));
    expect(report.diagnostics.some(issue => issue.code === 'consumed-services.invalid')).toBe(false);
  });

  it('reports a malformed manifest as invalid and skips dependent checks', async () => {
    fs.writeFileSync(path.join(root, 'apack.json'), '{');
    expect(await validatePack(root)).toMatchObject({
      status: 'invalid', diagnostics: [expect.objectContaining({ code: 'manifest.json' })],
      skippedChecks: [{ check: 'declared-sources' }, { check: 'dependencies' }, { check: 'codegen' }, { check: 'source-rules' }],
    });
    expect(inspectDependencies).not.toHaveBeenCalled();
    expect(generatePackFiles).not.toHaveBeenCalled();
  });

  it('distinguishes complete validation from codegen failure', async () => {
    expect(await validatePack(root)).toMatchObject({ status: 'valid', diagnostics: [], skippedChecks: [] });
    vi.mocked(generatePackFiles).mockImplementation(() => { throw new Error('Missing export'); });
    expect(await validatePack(root)).toMatchObject({
      status: 'invalid', diagnostics: [{ code: 'codegen.failed', severity: 'error', message: 'Missing export' }],
      skippedChecks: [{ check: 'remaining-codegen' }],
    });
  });

  it.each(['text', 'json'])('renders an incomplete %s report and exits 2 without claiming validity', async format => {
    vi.mocked(inspectDependencies).mockResolvedValue({ entries: [{ id: 'base', spec: '*', status: 'unavailable', problem: 'Offline' }], files: new Map() });
    vi.spyOn(process, 'cwd').mockReturnValue(root);
    const output = vi.spyOn(console, 'log').mockImplementation(() => {});
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(validate(format === 'json' ? ['--json'] : [])).rejects.toThrow('exit');
    expect(exit).toHaveBeenCalledWith(2);
    const text = output.mock.calls.map(args => args.join(' ')).join('\n');
    expect(text).not.toContain('Pack is valid');
    if (format === 'json') {
      expect(output).toHaveBeenCalledTimes(1);
      expect(JSON.parse(text)).toEqual(await validatePack(root));
    } else {
      expect(text).toContain('Validation incomplete');
      expect(text).toContain('codegen');
    }
  });
});
