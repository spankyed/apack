import { execFile } from 'node:child_process';
import { findPackageDirectory } from '@apackdev/host/build/package-inputs';
import { promisify } from 'node:util';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CONSUMER_MATRIX, PACKAGES_BUILT, PACKED_PACKAGES, REPO_ROOT, TSC_VERSIONS, installPublishedPackages } from '../src/published-packages.ts';

/** Every export of the packed @apackdev/ears, @apackdev/sdk and @apackdev/ui resolves to declarations for consumers. */
let consumer: string | undefined;
beforeAll(() => {
  if (PACKAGES_BUILT) consumer = installPublishedPackages();
});
afterAll(() => {
  if (consumer) fs.rmSync(consumer, { recursive: true, force: true });
});

/** The packed package's exports, and whether each is code a consumer imports */
function exportsOf(name: string): Array<{ key: string; code: boolean }> {
  const manifest = JSON.parse(fs.readFileSync(path.join(consumer!, 'node_modules', '@apackdev', name, 'package.json'), 'utf-8'));
  return Object.entries(manifest.exports as Record<string, unknown>).map(([key, target]) => ({
    key,
    code: !key.endsWith('.json') && typeof target === 'object' && target !== null && 'types' in target,
  }));
}

/** Export subpaths a consumer imports as code: not metadata, and not a source-only host hook. */
function codeExports(name: string): string[] {
  return exportsOf(name).filter((entry) => entry.code).map(({ key }) => `@apackdev/${name}${key.slice(1)}`);
}

function nonCodeExports(name: string): string[] {
  return exportsOf(name).filter((entry) => !entry.code).map(({ key }) => key);
}


const execFileAsync = promisify(execFile);

describe.skipIf(!PACKAGES_BUILT)('published package exports', () => {
  it("preserves each packed package's installed external dependency versions", () => {
    for (const name of Object.keys(PACKED_PACKAGES)) {
      const workspace = findPackageDirectory(REPO_ROOT, `@apackdev/${name}`)!;
      const target = path.join(consumer!, 'node_modules', '@apackdev', name);
      const manifest = JSON.parse(fs.readFileSync(path.join(target, 'package.json'), 'utf8'));
      for (const dependency of Object.keys(manifest.dependencies ?? {})) {
        if (dependency.startsWith('@apackdev/')) continue;
        const expected = findPackageDirectory(workspace.directory, dependency);
        expect(expected, `${name} must have its declared ${dependency} installed`).toBeDefined();
        expect(findPackageDirectory(target, dependency)?.directory,
          `${name} must resolve its own ${dependency}, including a private version override`).toBe(expected!.directory);
      }
    }
  });

  it.each(CONSUMER_MATRIX)('all resolve to declarations under TypeScript $tsc, moduleResolution $moduleResolution', async ({ tsc, moduleResolution }) => {
    const specifiers = [...codeExports('ears'), ...codeExports('sdk'), ...codeExports('ui')];
    // Every export is code but these: the manifests and the schema. A new export without declarations lands
    // in this list and fails here. The SDK's source-only `./runtime/internals` is not among them because the
    // published manifest has no such entry — `publishedManifest` drops one the source condition was the whole of
    expect(nonCodeExports('ears')).toEqual(['./package.json']);
    expect(nonCodeExports('sdk')).toEqual(['./package.json', './apack.schema.json']);
    expect(nonCodeExports('ui')).toEqual(['./package.json']);
    expect(specifiers).toEqual(expect.arrayContaining(['@apackdev/ears', '@apackdev/ears/lmdb', '@apackdev/sdk/repositories', '@apackdev/sdk/events', '@apackdev/sdk/templates', '@apackdev/ui/components/tiptap/TiptapEditor']));
    // Packs send with @apackdev/sdk/events; the host's transport and API client aren't an entry
    fs.writeFileSync(path.join(consumer!, 'package.json'), JSON.stringify({ name: 'consumer', type: 'module' }));
    fs.writeFileSync(path.join(consumer!, 'tsconfig.json'), JSON.stringify({
      compilerOptions: {
        target: 'ES2022', module: moduleResolution === 'node16' ? 'node16' : 'esnext', moduleResolution,
        strict: true, skipLibCheck: true, noEmit: true, types: [], lib: ['ES2022', 'DOM'],
        // An unresolved import would be an error; an import that resolved to JS without types would be `any`
        noImplicitAny: true,
      },
      include: ['exports.ts'],
    }));
    fs.writeFileSync(path.join(consumer!, 'exports.ts'), specifiers
      .map((specifier, i) => `export * as m${i} from '${specifier}';`)
      .join('\n'));

    let output = '';
    try {
      await execFileAsync(process.execPath, [TSC_VERSIONS[tsc], '-p', consumer!],
        { encoding: 'utf8', timeout: 60_000, maxBuffer: 64 * 1024 * 1024 });
    } catch (err: any) {
      // A compiler that exited with errors reports them; a timeout, a signal or a failed spawn has no exit code
      if (typeof err.code !== 'number') throw err;
      output = `${err.stdout ?? ''}${err.stderr ?? ''}`;
    }
    expect(output).toBe('');
  });
});
