// The app-only exports (the elmdb databases) stay out of what pack code shares: the app's bridge and the harness's
import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { APP_ONLY_EXPORTS, SHARED_DEPS, SHARED_INSTANCE_PACKAGES, THROUGH_SDK, getSharedBeDeps, getSharedFeDeps, getSdkFeModules, getUiFeModules, sharedFeModules, sharedInstancePackage, unresolvedSubpathPackages, sharedInstanceExports } from '../../src/build/shared-deps.ts';
import { createRequire } from 'node:module';
import { readPackageManifest } from '../../src/build/package-identity.ts';
import { packageName } from '../../src/build/specifiers.ts';
import { appBridgedSpecifiers } from '../../src/build/render-sdk-modules.ts';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..', '..', '..');

describe('APP_ONLY_EXPORTS', () => {
  it('names exports their packages have', () => {
    for (const specifier of Object.keys(APP_ONLY_EXPORTS)) {
      const pkg = packageName(specifier);
      const exported = readPackageManifest(path.dirname(createRequire(import.meta.filename).resolve(`${pkg}/package.json`))) as { exports?: Record<string, unknown> };
      expect(Object.keys(exported.exports ?? {})).toContain(`.${specifier.slice(pkg.length)}`);
    }
  });

  it('are none of what the app bridges for pack code', () => {
    const bridged = appBridgedSpecifiers(import.meta.filename);
    for (const specifier of Object.keys(APP_ONLY_EXPORTS)) expect(bridged).not.toContain(specifier);
  });
});

describe('SHARED_INSTANCE_PACKAGES', () => {
  // A pack reaches EARS only through the SDK, so sharing the SDK shares the EARS it loads: EARS on the list would be a
  // second route to it, which is what the `ears-imports` pack rule and the facade's rewrite take away.
  // `@apackdev/state` is bridged alongside the SDK so host and CJS pack runtimes share one ESM instance (including
  // `ANSWERED` and `given` Symbol singletons).
  it('shares the SDK and @apackdev/state, and every package a pack reaches through the SDK is reached through one of its entries', () => {
    expect([...SHARED_INSTANCE_PACKAGES]).toEqual(['@apackdev/sdk', '@apackdev/state']);
    for (const [pkg, entry] of Object.entries(THROUGH_SDK)) {
      expect(sharedInstancePackage(pkg), pkg).toBeUndefined();
      expect(sharedInstancePackage(entry), entry).toBe('@apackdev/sdk');
    }
  });
});

describe('sharedInstanceExports', () => {
  const write = (root: string, file: string, body: object) => {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), JSON.stringify(body));
  };

  it("reads the exports map of the copy Node gives the file's directory, and refuses one that doesn't resolve", () => {
    const pack = fs.mkdtempSync(path.join(os.tmpdir(), 'shared-instance-'));
    try {
      write(pack, 'package.json', { name: 'pack', dependencies: { '@apackdev/sdk': '*' } });
      expect(() => sharedInstanceExports('@apackdev/sdk', path.join(pack, 'index.ts'))).toThrow("@apackdev/sdk doesn't resolve from");
      write(pack, 'node_modules/@apackdev/sdk/package.json', { name: '@apackdev/sdk', exports: { './own': './x.js' } });
      expect(sharedInstanceExports('@apackdev/sdk', path.join(pack, 'index.ts'))).toEqual({ './own': './x.js' });
    } finally {
      fs.rmSync(pack, { recursive: true, force: true });
    }
  });
});

describe('getSharedBeDeps', () => {
  it('names the packages a pack backend gets from the host, and no frontend-only one', () => {
    const be = getSharedBeDeps();
    // `both` and `be` entries: @apackdev/state, xstate, and zod
    expect(be.sort()).toEqual(['@apackdev/state', 'xstate', 'zod']);
    for (const name of be) expect(SHARED_DEPS[name].target, name).not.toBe('fe');
    for (const [name, dep] of Object.entries(SHARED_DEPS)) {
      if (dep.target === 'fe') expect(be, name).not.toContain(name);
    }
  });

  it("doesn't list subpaths: the bridge resolves them from the host as they come", () => {
    // A pack bundle leaves `zod` external, and a dependency inside it may require `zod/v4`
    expect(getSharedBeDeps().some((name) => packageName(name) !== name)).toBe(false);
  });

  it('shares nothing with the frontend list that the frontend gets under another key', () => {
    const fe = getSharedFeDeps(REPO_ROOT);
    for (const name of getSharedBeDeps()) {
      if (fe[name]) expect(SHARED_DEPS[name].target, name).toBe('both');
    }
  });
});

describe('the shared tiptap and ProseMirror subpaths', () => {
  // They used to resolve from this module's own location, which is inside the CLI bundle: under a
  // global CLI, npx or pnpm that found nothing, returned no subpaths, and a build.bundleUi pack inlined
  // its own ProseMirror — the duplicate instance the sharing exists to prevent, with no error.
  it('resolves from the directory it is given, not from this module', () => {
    expect(Object.keys(getSharedFeDeps(REPO_ROOT))).toEqual(expect.arrayContaining(['@tiptap/pm/state', 'prosemirror-state']));
  });

  it('reports what it could not resolve instead of silently sharing nothing', () => {
    const nowhere = fs.mkdtempSync(path.join(os.tmpdir(), 'shared-deps-'));
    try {
      expect(unresolvedSubpathPackages(nowhere)).toEqual(['@tiptap/pm', '@tiptap/vue-3']);
      expect(Object.keys(getSharedFeDeps(nowhere))).not.toContain('@tiptap/pm/state');
      expect(unresolvedSubpathPackages(REPO_ROOT)).toEqual([]);
    } finally {
      fs.rmSync(nowhere, { recursive: true, force: true });
    }
  });

  it('finds them through any of the directories it is given', () => {
    const nowhere = fs.mkdtempSync(path.join(os.tmpdir(), 'shared-deps-'));
    try {
      expect(unresolvedSubpathPackages(nowhere, REPO_ROOT)).toEqual([]);
    } finally {
      fs.rmSync(nowhere, { recursive: true, force: true });
    }
  });
});

// The one list the renderer serves from and the pack bundler externalises against. What it has to get right
// is that a specifier and the module behind it are different questions: a pack may import either spelling of
// a ProseMirror module, and both have to arrive at one module or the app has two copies of ProseMirror.
describe('sharedFeModules', () => {
  const RENDERER = path.join(REPO_ROOT, 'packages', 'renderer');

  it('covers every specifier from all three populations', () => {
    const modules = sharedFeModules(RENDERER);

    for (const specifier of Object.keys(getSharedFeDeps(RENDERER))) expect(modules, specifier).toHaveProperty([specifier]);
    for (const specifier of Object.keys(getSdkFeModules())) expect(modules, specifier).toHaveProperty([specifier]);
    for (const specifier of Object.keys(getUiFeModules(RENDERER))) expect(modules, specifier).toHaveProperty([specifier]);
    expect(Object.keys(modules).length).toBeGreaterThan(0);
  });

  // `@tiptap/pm/model` is `export * from 'prosemirror-model'`, so the module is the prosemirror one. Pointing
  // the two spellings at two modules is two copies of ProseMirror, which is what sharing them is for.
  it('sends both spellings of a ProseMirror module to the prosemirror package', () => {
    const modules = sharedFeModules(RENDERER);

    expect(modules['prosemirror-model']).toBe('prosemirror-model');
    expect(modules['@tiptap/pm/model']).toBe('prosemirror-model');
  });

  it('leaves every other specifier naming itself', () => {
    const modules = sharedFeModules(RENDERER);

    expect(modules['vue']).toBe('vue');
    expect(modules['@xstate/vue']).toBe('@xstate/vue');
    expect(modules['@apackdev/state']).toBe('@apackdev/state');
    expect(modules['@apackdev/state/vue']).toBe('@apackdev/state/vue');
    expect(modules['@apackdev/sdk/fe']).toBe('@apackdev/sdk/fe');
    expect(modules['@apackdev/ui/design/button']).toBe('@apackdev/ui/design/button');
  });

  // The mutation: from a directory with none of the packages installed, the subpaths resolve to nothing, so
  // the answer must lose them rather than name modules the host cannot serve. Without this the two cases
  // above would pass over a hard-coded pair.
  it('names no module it could not resolve', () => {
    const nowhere = fs.mkdtempSync(path.join(os.tmpdir(), 'shared-fe-modules-'));
    try {
      const modules = sharedFeModules(nowhere);

      expect(modules).not.toHaveProperty(['prosemirror-model']);
      expect(modules).not.toHaveProperty(['@tiptap/pm/model']);
      expect(modules).not.toHaveProperty(['@apackdev/ui/design/button']);
      // What survives is the list that needs no install to be read
      expect(modules['vue']).toBe('vue');
    } finally {
      fs.rmSync(nowhere, { recursive: true, force: true });
    }
  });
});
