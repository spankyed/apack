import { createHash } from 'node:crypto';
import { builtinModules } from 'node:module';
import * as vm from 'node:vm';
import * as esbuild from 'esbuild';
import { describe, expect, it } from 'vitest';
import { _declarationRevision, isHostCompatible, sha256Hex } from '../src/index.ts';

const NODE_BUILTINS = new Set([...builtinModules, ...builtinModules.map((m) => `node:${m}`)]);

describe('@apackdev/pack-format Workers safety', () => {
  it('bundles for a neutral/Workers runtime with zero node:* builtins and zero ajv', async () => {
    const nodeImports: string[] = [];
    const result = await esbuild.build({
      stdin: { contents: "export * from '../src/index.ts';", resolveDir: import.meta.dirname },
      bundle: true,
      write: false,
      format: 'esm',
      platform: 'neutral',
      mainFields: ['module', 'main'],
      conditions: ['@apackdev/source', 'worker', 'browser'],
      metafile: true,
      plugins: [{
        name: 'forbid-node-builtins',
        setup(build) {
          build.onResolve({ filter: /.*/ }, (args) => {
            if (NODE_BUILTINS.has(args.path) || args.path.startsWith('node:')) {
              nodeImports.push(`${args.importer} -> ${args.path}`);
              return { path: args.path, external: true };
            }
            return undefined;
          });
        },
      }],
    });

    const inputs = Object.keys(result.metafile!.inputs);
    expect(nodeImports).toEqual([]);
    expect(inputs.some((input) => /(?:^|\/)src\/index\.ts$/.test(input))).toBe(true);
    expect(inputs.some((input) => /(?:^|\/)src\/declaration-schema\.ts$/.test(input))).toBe(true);
    expect(inputs.some((input) => /(?:^|\/)node_modules\/ajv\//.test(input))).toBe(false);
    expect(inputs.some((input) => /(?:^|\/)apack-pack-build\//.test(input))).toBe(false);
  });

  it('executes parseManifest, parseSnapshot, isHostCompatible, and _declarationRevision in a Node-free VM context', async () => {
    const built = await esbuild.build({
      stdin: { contents: "export * from '../src/index.ts';", resolveDir: import.meta.dirname },
      bundle: true,
      write: false,
      format: 'iife',
      globalName: 'PackFormat',
      platform: 'neutral',
      mainFields: ['module', 'main'],
      conditions: ['@apackdev/source', 'worker', 'browser'],
    });
    const code = built.outputFiles![0]!.text;
    // Web-only globals matching Cloudflare Workers: zero process, Buffer, require, __dirname, __filename, global
    const context = vm.createContext({ TextEncoder, TextDecoder, structuredClone, URL, AbortController, console });
    vm.runInContext(code, context);
    const mod = (context as { PackFormat: typeof import('../src/index.ts') }).PackFormat;

    const manifest = { id: 'worker-pack', name: 'Worker Pack', version: '1.0.0', hostVersion: '>=0.4.0' };
    const validation = mod.parseManifest(manifest);
    expect(validation.status).toBe('valid');
    expect(validation.diagnostics).toEqual([]);
    const parsedManifest = mod.ManifestSchema.parse(manifest);
    expect(parsedManifest.id).toBe('worker-pack');

    const revision = mod._declarationRevision(parsedManifest);
    expect(revision).toMatch(/^[a-f0-9]{64}$/);
    expect(mod.isHostCompatible(parsedManifest.hostVersion, '0.4.0-beta.1')).toBe(true);
    expect(mod.isHostCompatible(parsedManifest.hostVersion, '0.3.9')).toBe(false);

    const parsedSnapshot = mod.parseSnapshot({
      format: mod.PACK_SNAPSHOT_FORMAT,
      manifest: parsedManifest,
      declarationRevision: revision,
      types: { entities: {}, relKinds: {}, roles: {} },
      entityDestinations: {},
      facades: {},
    });
    expect(parsedSnapshot.diagnostics).toEqual([]);
    expect(parsedSnapshot.snapshot?.declarationRevision).toBe(revision);
  });

  it('computes pure-JS SHA-256 identically to node:crypto across edge cases', () => {
    const samples = [
      '',
      'a',
      'abc',
      'x'.repeat(55),
      'x'.repeat(56),
      'x'.repeat(63),
      'x'.repeat(64),
      'x'.repeat(65),
      'x'.repeat(128),
      'hello 🌍 世界 — pack manifest unicode 🚀',
    ];
    for (const sample of samples) {
      const expected = createHash('sha256').update(sample, 'utf8').digest('hex');
      expect(sha256Hex(sample)).toBe(expected);
    }

    const manifest = { id: 'demo-pack', name: 'Demo 🚀', version: '1.2.3', features: { notes: { description: 'Notes' } } };
    const revision = _declarationRevision(manifest);
    expect(revision).toMatch(/^[a-f0-9]{64}$/);
    expect(_declarationRevision({ version: '1.2.3', features: { notes: { description: 'Notes' } }, name: 'Demo 🚀', id: 'demo-pack' })).toBe(revision);
  });

  it('checks host compatibility including prereleases counted as their release', () => {
    expect(isHostCompatible(undefined, '0.4.0')).toBe(true);
    expect(isHostCompatible('>=0.4.0', '0.4.0')).toBe(true);
    expect(isHostCompatible('>=0.4.0', '0.4.0-beta.2')).toBe(true);
    expect(isHostCompatible('>=0.5.0', '0.4.9')).toBe(false);
    expect(isHostCompatible('not-a-range', '0.4.0')).toBe(false);
  });
});
