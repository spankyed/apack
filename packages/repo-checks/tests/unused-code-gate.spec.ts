import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import ts from 'typescript';
import { REPO_ROOT } from '@apackdev/host/build/packages-built';
import { execFileWhileWorking } from '@apackdev/sdk/progress';
import { population } from '@apackdev/sdk/testing';
import { PACKAGE_DIRS } from '../../../scripts/lib/workspace-deps.ts';

/**
 * The compiler reports unused code, in every package, and nothing has to opt in.
 *
 * `noUnusedLocals` catches a class the linter structurally cannot. Measured the day this landed: `oxlint`
 * reads 114 files in `@apackdev/ui` and reports zero, where `vue-tsc --noUnusedLocals` reports ten — it does
 * not analyse bindings inside an SFC's script block. Twenty-seven findings survived a fully green lint run,
 * in `.vue` scripts and in generated code, which is why this gate is the compiler's rather than the linter's.
 *
 * The gate decays the way lint coverage did — silently, one new package at a time — so the flag is checked
 * rather than trusted. Two halves, because there are two ways to have no gate: a config that omits the flag,
 * and a package whose source no config compiles.
 *
 * **Every tsconfig, not one per workspace.** A package's checks run through more configs than its
 * `tsconfig.json`: `typecheck:api` compiles `packages/api` through three, and the published packages build
 * through a `tsconfig.package.json`. All of those inherit the flag today, and a narrower population would
 * pass while one of them turned it off. What is excluded is derived rather than named — a config whose
 * parsed file list is empty compiles nothing, which is what a solution config like the renderer's root is.
 * A config whose input a build generates is judged by that, not by whether the build has run in this tree.
 *
 * The option is read *effective* rather than literal, through the same parser `tsc` uses. That matters
 * twice: these configs carry `//` comments, which `JSON.parse` rejects, and most of them inherit the flag
 * through `extends` rather than spelling it.
 */

const packageDirs = (): string[] =>
  [...PACKAGE_DIRS];

/**
 * A config that compiles source and is still not gated, and why. API Extractor reads a package's built
 * declarations to produce its report; an unused local in that input is not a finding it should refuse to
 * run over, and `api:update` is not where dead code is meant to surface.
 */
const NOT_GATED: Record<string, string> = {
  'packages/apack-ears/tsconfig.api-extractor.json': 'API Extractor\'s input, not a check',
  'packages/apack-sdk/tsconfig.api-extractor.json': 'API Extractor\'s input, not a check',
  'packages/apack-ui/tsconfig.api-extractor.json': 'API Extractor\'s input, not a check',
  'packages/apack-testing/tsconfig.api-extractor.json': 'API Extractor\'s input, not a check',
};

interface Config {
  readonly rel: string;
  readonly file: string;
  readonly compiles: number;
  readonly gated: boolean;
  readonly generated: boolean;
}

/** Whether git ignores `target`, which needn't exist: what a build writes is ignored, and may not be there yet */
const ignored = (target: string): Promise<boolean> =>
  execFileWhileWorking('git', ['check-ignore', '-q', target], { cwd: REPO_ROOT }).then(() => true, () => false);

/**
 * Whether everything a config includes is generated: each pattern's directory is one git ignores, so the config
 * compiles whatever a build left there, and nothing in a tree where that build hasn't run. The UI's API Extractor
 * input, `.temp/api-types`, is one: `api:build` writes it
 */
const readsGenerated = async (include: unknown, dir: string): Promise<boolean> => {
  if (!Array.isArray(include) || include.length === 0) return false;
  for (const pattern of include) {
    const parts = String(pattern).split('/');
    const wild = parts.findIndex((part) => /[*?{]/.test(part));
    const literal = (wild === -1 ? parts : parts.slice(0, wild)).join('/');
    if (literal === '' || !(await ignored(path.join(dir, literal)))) return false;
  }
  return true;
};

const parse = async (file: string): Promise<{ compiles: number; gated: boolean; generated: boolean }> => {
  const read = ts.readConfigFile(file, ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, path.dirname(file));
  return {
    compiles: parsed.fileNames.length,
    gated: parsed.options.noUnusedLocals === true,
    generated: await readsGenerated(read.config?.include, path.dirname(file)),
  };
};

const tsconfigsIn = (workspace: string): string[] => {
  const dir = path.join(REPO_ROOT, 'packages', workspace);
  return fs.readdirSync(dir).filter((file) => /^tsconfig.*\.json$/.test(file)).map((file) => path.join(dir, file)).sort();
};

/**
 * Every tsconfig in the tree that compiles at least one file, or compiles what a build generates, so an empty
 * solution config drops out on its own and a generated input's config stays in whether or not the build has run
 */
const compilingConfigs = async (): Promise<Config[]> => (await Promise.all(packageDirs()
  .flatMap(tsconfigsIn)
  .map(async (file) => ({ rel: path.relative(REPO_ROOT, file), file, ...await parse(file) }))))
  .filter((config) => config.compiles > 0 || config.generated);

const hasTypeScript = (workspace: string): boolean => {
  const src = path.join(REPO_ROOT, 'packages', workspace, 'src');
  const walk = (dir: string): boolean => fs.readdirSync(dir, { withFileTypes: true }).some((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : /\.(ts|tsx|vue)$/.test(entry.name);
  });
  return fs.existsSync(src) && walk(src);
};

describe('every workspace is checked for unused code', () => {
  it('sets noUnusedLocals in every config that compiles source', async () => {
    const configs = population('the tsconfigs that compile source', await compilingConfigs(), { atLeast: 15 });
    const missing = configs.filter((config) => !config.gated && !(config.rel in NOT_GATED)).map((config) => config.rel);
    expect(missing, 'add "noUnusedLocals": true to these, or to NOT_GATED with a reason: a config without it '
      + 'is one the compiler stops reporting dead code through, and nothing else reports the kind it finds').toEqual([]);
  });

  // Otherwise the flag above is dodged by having no config at all, which reads the same as passing
  it('leaves no package with TypeScript and no config to compile it', () => {
    // Asked of the tree rather than read off a list. There was a `NO_TSCONFIG` here naming the two
    // workspaces that need none, and `hasTypeScript` — thirty lines up, and already run as this case's
    // second assertion — answers the same question exactly, so the list was a cached copy of its neighbour.
    const unconfigured = packageDirs()
      .filter((workspace) => tsconfigsIn(workspace).length === 0)
      .filter(hasTypeScript);
    expect(unconfigured, 'give these a tsconfig.json: a workspace with TypeScript and no config to compile '
      + 'it is one the unused-code flag above cannot reach').toEqual([]);
  });

  // A list of exceptions is only honest while each one is still an exception
  it('lists no exception that has stopped applying', async () => {
    const compiling = new Set((await compilingConfigs()).map((config) => config.rel));
    const ungrounded = Object.keys(NOT_GATED).filter((rel) => !compiling.has(rel));
    expect(ungrounded, 'these are gone or no longer compile anything, so nothing exempts them; drop them '
      + 'from NOT_GATED').toEqual([]);
    const gatedAnyway = (await compilingConfigs()).filter((config) => config.rel in NOT_GATED && config.gated).map((config) => config.rel);
    expect(gatedAnyway, 'these set the flag despite being listed as not gated; drop them from NOT_GATED').toEqual([]);
  });

  /**
   * Three ways this check could read something other than what it claims, each broken on purpose here. A
   * config missing the flag, a config inheriting it and a config compiling nothing are all things this can
   * construct from what it already parses, so each costs microseconds and runs every time.
   */
  describe('reads the flag rather than something that resembles it', () => {
    it('reports a config that drops the flag', () => {
      const real = path.join(REPO_ROOT, 'packages', 'apack-host', 'tsconfig.json');
      const read = ts.readConfigFile(real, ts.sys.readFile);
      const options = (read.config as { compilerOptions: Record<string, unknown> }).compilerOptions;
      expect(options.noUnusedLocals, 'the file this mutates has stopped setting the flag literally').toBe(true);
      delete options.noUnusedLocals;
      const without = ts.parseJsonConfigFileContent(read.config, ts.sys, path.dirname(real));
      expect(without.options.noUnusedLocals, 'dropping the flag has to change the answer').not.toBe(true);
    });

    // Most configs here inherit rather than spell it, and an inherited `false` is the way this decays
    // without anything being deleted
    it('follows extends, in both directions', () => {
      const base = path.join(REPO_ROOT, 'packages', 'api');
      const effective = (compilerOptions: Record<string, unknown>): boolean | undefined =>
        ts.parseJsonConfigFileContent({ extends: './tsconfig.json', compilerOptions }, ts.sys, base).options.noUnusedLocals;
      expect(effective({}), 'a config that only extends has to inherit the flag, or the population above is '
        + 'being read as ungated wherever it is inherited').toBe(true);
      expect(effective({ noUnusedLocals: false }), 'an override has to win, or turning the gate off in a '
        + 'child config would read as on').toBe(false);
    });

    // A config reading generated input is recognised by where its input is, so this rule has something to apply to
    it('recognises a config whose input a build generates, and only by where that input is', async () => {
      const files = packageDirs().flatMap(tsconfigsIn);
      const parsed = await Promise.all(files.map(parse));
      const generated = population('the configs reading generated input',
        files.filter((_, index) => parsed[index]!.generated), { atLeast: 1 });
      expect(generated.every((file) => !/[/\\]tsconfig\.json$/.test(file)), 'a package\'s own tsconfig reads its '
        + 'source, which git tracks').toBe(true);
    });

    // The one config excluded from the population is excluded for what it compiles, not for its name
    it('excludes a config that compiles nothing, and only that', async () => {
      const empty = (await Promise.all(packageDirs().flatMap(tsconfigsIn)
        .map(async (file) => ({ rel: path.relative(REPO_ROOT, file), ...await parse(file) }))))
        .filter((config) => config.compiles === 0 && !config.generated);
      expect(empty.map((config) => config.rel), 'the only config compiling nothing should be the renderer\'s '
        + 'solution config; another one here is a config whose include has stopped matching').toEqual(['packages/renderer/tsconfig.json']);
      expect(empty[0]!.gated, 'if the solution config ever sets the flag this exclusion stops being free, '
        + 'because it would then be the one place the answer came from').toBe(false);
    });
  });
});
