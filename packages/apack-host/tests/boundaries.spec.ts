// Package boundaries: host holds app runtime, never transport, and the modules the CLI and the pack test
// harness import stay clear of the pack runtime the app runs.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { HostRuntime } from '@apackdev/sdk/runtime';
import ts from 'typescript';

const HOST_ROOT = path.resolve(__dirname, '..');
const SRC = path.join(HOST_ROOT, 'src');
const RUNTIME = path.join(SRC, 'packs', 'runtime');

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.(ts|mts|cts|js|mjs|cjs)$/.test(entry.name) ? [full] : [];
  });
}

interface Import {
  specifier: string;
  /** `import type` / `export type`: erased, so it loads nothing */
  typeOnly: boolean;
}

function importsOf(file: string): Import[] {
  const source = fs.readFileSync(file, 'utf8');
  const found: Import[] = [];
  for (const match of source.matchAll(/^\s*(?:import|export)\s+(type\s+)?(?:[^'";]*?\sfrom\s+)?['"]([^'"]+)['"]/gm)) {
    found.push({ specifier: match[2], typeOnly: Boolean(match[1]) });
  }
  for (const match of source.matchAll(/\b(?:import|require)\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    found.push({ specifier: match[1], typeOnly: false });
  }
  return found;
}

/** The host source files `entry` loads at runtime, itself included */
function runtimeClosure(entry: string): Set<string> {
  const seen = new Set<string>();
  const visit = (file: string) => {
    if (seen.has(file)) return;
    seen.add(file);
    for (const { specifier, typeOnly } of importsOf(file)) {
      if (typeOnly || !specifier.startsWith('.')) continue;
      const target = path.resolve(path.dirname(file), specifier);
      if (!fs.existsSync(target)) throw new Error(`${path.relative(HOST_ROOT, file)} imports ${specifier}, which doesn't exist`);
      visit(target);
    }
  };
  visit(entry);
  return seen;
}

/** The services the app implements, each in `src/services/<kebab-case key>.ts`; the type checks the list is complete */
const HOST_SERVICE_KEYS = ['appData', 'onboarding', 'runHistory', 'inference', 'secrets', 'filesystem', 'terminal', 'settings'] as const satisfies readonly (keyof HostRuntime['services'])[];
type MissingServiceKey = Exclude<keyof HostRuntime['services'], (typeof HOST_SERVICE_KEYS)[number]>;
const serviceKeysComplete: [MissingServiceKey] extends [never] ? true : MissingServiceKey = true;
const kebab = (key: string) => key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

const inRuntime = (file: string) => file.startsWith(RUNTIME + path.sep);

const rel = (file: string) => path.relative(HOST_ROOT, file);

/** Inspect accesses, not comments or import paths such as settings/document.ts. */
function browserGlobals(file: string): string[] {
  const found: string[] = [];
  const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  function visit(node: ts.Node): void {
    if ((ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node))
      && ts.isIdentifier(node.expression) && ['window', 'document', 'localStorage'].includes(node.expression.text)) {
      found.push(node.getText(source));
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return found;
}

describe('host package boundaries', () => {
  // The record's shape is one module's business. Every write outside it is a named intention — an
  // install, a choice, a check's findings — so no call site merges rows, and none can silently write
  // nothing because the row it was looking for wasn't there.
  it('keeps the installed-packs file shape inside installed.ts', () => {
    const owner = path.join(SRC, 'packs', 'installed.ts');
    const offenders = sourceFiles(SRC)
      .filter((file) => file !== owner)
      .filter((file) => /\b(addInstalledPack|removeInstalledPack|updateInstalledPacks)\b/.test(fs.readFileSync(file, 'utf-8')));

    expect(offenders.map((file) => path.relative(HOST_ROOT, file))).toEqual([]);
  });

  it('imports no transport: fastify, @trpc/*, ws or virtual:* modules', () => {
    const transport = /^(fastify(\/|$)|@fastify\/|@trpc\/|ws$|ws\/|virtual:)/;
    const offending = sourceFiles(SRC).flatMap((file) =>
      importsOf(file).filter(({ specifier }) => transport.test(specifier)).map(({ specifier }) => `${rel(file)}: ${specifier}`));
    expect(offending, 'Transport belongs in packages/api; host is also run by the CLI and the pack test harness').toEqual([]);
  });

  it('imports itself by relative path, never as @apackdev/host/*', () => {
    const offending = sourceFiles(SRC).flatMap((file) =>
      importsOf(file).filter(({ specifier }) => /^@apackdev\/host(\/|$)/.test(specifier)).map(({ specifier }) => `${rel(file)}: ${specifier}`));
    expect(offending).toEqual([]);
  });

  it('keeps the @apackdev/host/packs barrel clear of the pack runtime', () => {
    const reached = [...runtimeClosure(path.join(SRC, 'packs', 'index.ts'))].filter(inRuntime).map(rel);
    expect(reached, 'The CLI imports @apackdev/host/packs: importing packs/runtime from it bundles the loader into @apackdev/cli').toEqual([]);
  });

  it('keeps the bus clear of the pack runtime', () => {
    const busFiles = sourceFiles(path.join(SRC, 'bus'));
    const reached = new Set(busFiles.flatMap((file) => [...runtimeClosure(file)]).filter(inRuntime));
    expect([...reached].map(rel), 'The pack test harness imports @apackdev/host/bus: it must not load the pack loader').toEqual([]);
  });

  // The shell and the frontend registry run in the renderer and in a pack's tests alike, so what differs between
  // those (the framework, the API client, the window) arrives as options rather than imports. Frontend code is
  // `src/fe` (the plumbing) and each host feature's `fe` (the shell, the Packs surface), so the rule follows both.
  // The app is the pack `host`, so its own features are laid out as a pack's. Before that, one feature's system
  // lived in `bus/` and the other's in `packs/runtime/`, with both frontends in `fe/`, which is how `bus/` came to
  // export a feature's system and `packs/` to run both other packs and one of the host's own.
  it("keeps feature implementations in be/ and fe/, with shared contracts beside them", () => {
    const features = fs.readdirSync(path.join(SRC, 'features'), { withFileTypes: true }).filter((e) => e.isDirectory());
    const halves = features.flatMap((f) => fs.readdirSync(path.join(SRC, 'features', f.name), { withFileTypes: true })
      .filter(entry => entry.isDirectory()).map((half) => `${f.name}/${half.name}`));

    expect(features.map((f) => f.name).sort()).toEqual(['application', 'help', 'packs', 'settings']);
    expect(halves.filter((h) => !/\/(be|fe)$/.test(h)), "a feature holds be/ and fe/, as a pack's does").toEqual([]);
  });

  // `core/shared/debug/` held the log output three such words deep before it was taken out: a folder named for a
  // layer rather than for what is in it takes whatever nobody placed, so the name is refused at any depth
  it('names no folder for a layer', () => {
    const LAYER_NAMES = ['core', 'shared', 'lib', 'libs', 'utils', 'util', 'common', 'helpers', 'misc'];
    const named = fs.readdirSync(SRC, { recursive: true, withFileTypes: true })
      .filter((e) => e.isDirectory() && LAYER_NAMES.includes(e.name))
      .map((e) => path.relative(SRC, path.join(e.parentPath, e.name)));

    expect(named, 'name a folder for what is in it, not for the layer it sits in').toEqual([]);
  });

  it("keeps the frontend runtime free of Vue, tRPC, the renderer's modules and the browser's globals", () => {
    const frontendDirs = [path.join(SRC, 'fe'), ...fs.readdirSync(path.join(SRC, 'features'), { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => path.join(SRC, 'features', e.name, 'fe'))
      .filter((dir) => fs.existsSync(dir))];

    const found = frontendDirs.flatMap(sourceFiles).flatMap((file) => {
      const imports = importsOf(file).map((i) => i.specifier).filter((s) => s === 'vue' || s.startsWith('@/') || s.startsWith('@trpc/'));
      const globals = browserGlobals(file);
      return [...imports, ...globals].map((what) => `${path.relative(HOST_ROOT, file)}: ${what}`);
    });
    expect(found).toEqual([]);
  });

  it('keeps shared feature contracts and the frontend runtime free of Node-only modules', () => {
    const featureContracts = fs.readdirSync(path.join(SRC, 'features'), { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .flatMap(feature => fs.readdirSync(path.join(SRC, 'features', feature.name), { withFileTypes: true })
        .filter(entry => entry.isFile() && entry.name.endsWith('.ts'))
        .map(entry => path.join(SRC, 'features', feature.name, entry.name)));
    const reached = new Set([path.join(SRC, 'fe', 'index.ts'), ...featureContracts].flatMap(file => [...runtimeClosure(file)]));
    const forbidden = /^(node:|fs(?:\/|$)|crypto$|lmdb(?:\/|$)|@apackdev\/ears(?:\/|$)|@trpc\/)/;
    const imports = [...reached].flatMap(file => [
      ...importsOf(file).filter(imported => !imported.typeOnly && forbidden.test(imported.specifier))
        .map(imported => `${rel(file)}: ${imported.specifier}`),
      ...browserGlobals(file).map(global => `${rel(file)}: ${global}`),
    ]);
    expect(imports).toEqual([]);
  });

  it("holds only the app-implemented services in src/services, one file each, and the runtime's index", () => {
    expect(serviceKeysComplete).toBe(true);
    const files = fs.readdirSync(path.join(SRC, 'services')).sort();
    expect(files, 'src/services holds HostRuntime["services"]: put other host code in a module named by its concern')
      .toEqual([...HOST_SERVICE_KEYS.map((key) => `${kebab(key)}.ts`), 'index.ts'].sort());
  });
});
