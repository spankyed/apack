import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { population } from '../../src/testing/index.ts';

const SDK_ROOT = path.resolve(import.meta.dirname, '../..');

const FORBIDDEN_SDK_DEPS = [
  'zod',
  'ajv',
  'semver',
  'yaml',
  'mdast-util-from-markdown',
  'mdast-util-to-markdown',
  '@types/mdast',
  'json-schema-to-typescript',
  'esbuild',
  'typescript',
] as const;

describe('@apackdev/sdk package dependency and API surface boundary', () => {
  it('declares zero zod, ajv, format, or compiler dependencies', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(SDK_ROOT, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
      optionalDependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    for (const section of ['dependencies', 'peerDependencies', 'optionalDependencies', 'devDependencies'] as const) {
      const present = FORBIDDEN_SDK_DEPS.filter((dep) => dep in (pkg[section] ?? {}));
      expect(present, `unexpected ${section} in @apackdev/sdk/package.json`).toEqual([]);
    }
  });

  it('emits zero zod or ajv references across all API Extractor reports', () => {
    const etcDir = path.join(SDK_ROOT, 'etc');
    const reports = [...population('SDK etc/*.api.md reports', fs.readdirSync(etcDir).filter((file) => file.endsWith('.api.md')))];
    const offending: string[] = [];
    for (const file of reports) {
      const text = fs.readFileSync(path.join(etcDir, file), 'utf8');
      if (/\bfrom ['"](?:zod|ajv)['"]|\bimport\s*\{\s*z\s*\}\s*from\s*['"]zod['"]/i.test(text)) {
        offending.push(file);
      }
    }
    expect(offending).toEqual([]);
  });
});
