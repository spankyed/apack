import { describe, expect, it } from 'vitest';
import { _validPackVersion, _validPackRange, parsePackDependency } from '../src/dependency-source.ts';
import { _NativePackDeclarationSchema } from '../src/declaration-schema.ts';
import { parseManifest } from '../src/parse-manifest.ts';

describe('pack versions and dependency sources', () => {
  it.each(['0.0.0', '1.2.3', '1.2.3-beta.1', '1.2.3+build.001', '1.2.3-rc.1+build'])('accepts a complete version: %s', value => {
    expect(_validPackVersion(value)).toBe(true);
  });
  it.each(['', '1.2', 'v1.2.3', '01.2.3', '1.2.3garbage', '1.2.3-01', '1.2.3+', '1.2.3\n', '1.2.3 '])('refuses a malformed version: %j', value => {
    expect(_validPackVersion(value)).toBe(false);
  });
  it.each(['*', '^1.2.3', '~1.2', '>=0.3.0 <1.0.0', '1.2.3 - 2.0.0', '^1 || ^2', '>=1.0.0-beta.1'])('retains npm range semantics: %s', value => {
    expect(_validPackRange(value)).toBe(true);
    expect(parsePackDependency(value).range).toBe(value);
  });
  it('parses explicit file and GitHub sources without resolving them', () => {
    expect(parsePackDependency('file:../folder with spaces')).toEqual({ filePath: '../folder with spaces', github: null, range: '*' });
    expect(parsePackDependency('github:owner/repo')).toEqual({ filePath: null, github: 'owner/repo', range: '*' });
    expect(parsePackDependency('github:owner/repo >=1 <2')).toEqual({ filePath: null, github: 'owner/repo', range: '>=1 <2' });
  });
  it.each(['', ' ', 'nonsense', 'file:', 'github:', 'github:owner', 'github:owner/repo/extra', 'github:owner/repo nonsense', 'https://example.com/pack'])
    ('refuses unsupported dependency syntax: %j', value => { expect(() => parsePackDependency(value)).toThrow(); });
  it('native dependencies accept ranges and reject source locators and invalid IDs', () => {
    expect(_NativePackDeclarationSchema.safeParse({ id: 'native', dependencies: { provider: '^1.0.0' } }).success).toBe(true);
    for (const dependencies of [{ provider: '' }, { provider: 'file:../provider' }, { provider: 'github:owner/repo' }, { '../provider': '*' }]) {
      expect(_NativePackDeclarationSchema.safeParse({ id: 'native', dependencies }).success).toBe(false);
    }
  });
  it('reports each invalid value at its owning manifest path', () => {
    const report = parseManifest({ id: 'fixture', name: 'Fixture', version: '1.2.3garbage', hostVersion: 'nonsense', dependencies: { provider: 'github:owner/repo invalid' } });
    expect(report.status).toBe('invalid');
    expect(report.diagnostics.some(issue => issue.path.join('.') === 'version')).toBe(true);
    expect(report.diagnostics.some(issue => issue.path.join('.') === 'hostVersion')).toBe(true);
    expect(report.diagnostics.some(issue => issue.path.join('.') === 'dependencies.provider')).toBe(true);
  });
});
