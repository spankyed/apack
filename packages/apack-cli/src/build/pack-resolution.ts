/**
 * Where a pack's own compiler resolves the `@apackdev` packages: their published `dist`, or a checkout's source.
 *
 * A pack compiles against `dist` — the one layout a pack author ever has — and both of its bundlers do so
 * unconditionally: `bundlePackSource` hands esbuild the pack's tsconfig, and esbuild reads `baseUrl`, `paths` and
 * `experimentalDecorators` from one but has no notion of `customConditions` at all (measured: the string does not
 * appear in its binary); the FE bundler names Vite's default client conditions outright. `tsc` is the odd one out,
 * because it *does* honour `customConditions`. So a pack linked to a checkout that enables `@apackdev/source`
 * typechecks green against workspace source while shipping bundles built from `dist`: the typecheck proved
 * nothing, and the author finds out after publishing.
 *
 * **It resolves rather than reading config.** The repo's own `findMissingSourceConditions` reads configs, and has
 * to: it asks a different question — whether a *config* declares the condition, which covers a pack's vitest or
 * Vite config, where no module resolution happens under `tsc` at all. This one asks what the compiler actually
 * does, which catches every route to source (an `extends` chain, a `paths` entry, a project reference), needs no
 * config text parsed, and can name the file it landed on.
 *
 * `assertSourceResolution` (`@apackdev/host/build/source-resolution`) is the same question with the opposite
 * expectation, asked of a host process. It lives in `@apackdev/host` and this does not, because this needs
 * `typescript`, which `@apackdev/host` deliberately does not declare — `packages/server` imports host, and the
 * compiler has no business in the backend's tree.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { SOURCE_CONDITION, SOURCE_PACKAGES } from '@apackdev/host/build/source-resolution';
import ts from 'typescript';
import { readPackCompilerConfiguration } from './compiler-configuration.ts';
import { readSource } from './pack-sources.ts';
import type { PackWideFinding } from './pack-rules.ts';

/** One package a pack's compiler resolves to source, and the file it landed on */
export interface SourceResolution {
  readonly specifier: string;
  /** Relative to the pack, `/`-separated: what the report prints */
  readonly resolved: string;
}

/**
 * What this rule found, with "could not tell" as a value rather than as silence.
 *
 * `unreadable` is in the type because the alternative was returning `[]` for a pack whose `tsconfig.json` does
 * not parse — a pass, for a pack the rule never looked at. `findMissingSourceConditions` in the repo's own
 * script settled this the other way and says why: a rule that guesses is a rule that lets the next one
 * through. Having it in the result means a caller cannot drop it without deleting a line.
 */
export interface PackResolution {
  readonly resolved: SourceResolution[];
  /** Why the pack's compiler options could not be read, if they could not */
  readonly unreadable?: string;
}

/** The package a file belongs to: the nearest directory at or above it holding a `package.json` */
function packageRootOf(file: string): string | undefined {
  let dir = path.dirname(file);
  for (;;) {
    if (fs.existsSync(path.join(dir, 'package.json'))) return dir;
    const up = path.dirname(dir);
    if (up === dir) return undefined;
    dir = up;
  }
}

/**
 * Every `@apackdev` package this pack's `tsconfig.json` resolves to source instead of `dist`, or why that could
 * not be worked out.
 *
 * Empty for a pack with no tsconfig — there is nothing to resolve against and nothing to report — and, the
 * ordinary case, for one that resolves `dist`. A package the pack does not depend on does not resolve at all
 * and is skipped, rather than being reported as something worse than it is. A config that cannot be read comes
 * back as `unreadable`, never as an empty pass.
 */
export function packResolvesSource(packDir: string): PackResolution {
  const configFile = path.join(packDir, 'tsconfig.json');
  if (!fs.existsSync(configFile)) return { resolved: [] };
  let options: ts.CompilerOptions;
  try { options = readPackCompilerConfiguration(packDir)!.options; }
  catch (error) { return { resolved: [], unreadable: `tsconfig.json could not be read, so this rule could not check it: ${error instanceof Error ? error.message : String(error)}` }; }
  // Any path under the pack's `src`: a bare specifier resolves from the containing file's directory outwards, and
  // the file itself is never read, so it need not exist
  const from = path.join(packDir, 'src', 'index.ts');
  // TypeScript hands back a real path, so the report is relative to the pack's: on macOS a temp directory is
  // reached through /var and realpaths to /private/var, and the difference climbed out of the pack entirely
  const base = fs.realpathSync(packDir);
  const resolved = SOURCE_PACKAGES.flatMap((specifier) => {
    const file = ts.resolveModuleName(specifier, from, options, ts.sys).resolvedModule?.resolvedFileName;
    if (file === undefined) return [];
    const root = packageRootOf(file);
    if (root === undefined || !file.startsWith(path.join(root, 'src') + path.sep)) return [];
    return [{ specifier, resolved: path.relative(base, file).split(path.sep).join('/') }];
  });
  return { resolved };
}

/**
 * The pack's own Vite-family configs, which are the other place the condition can be turned on.
 *
 * Read as text rather than resolved, and that is not a relapse: `tsc` can be asked where it lands, but nothing
 * resolves a Vitest config's `resolve.conditions` until the run itself, and by then the pack's suite has
 * already passed against workspace source. The repo's own `findMissingSourceConditions` reads configs for the
 * same reason. What it cannot be is `definePackTestConfig`'s job — that helper *builds* a config and never sees
 * one, so a pack spreading its result and adding `resolve.conditions` is invisible to it.
 *
 * A string literal from the syntax tree, not a text search, so a comment about the condition is not a finding
 * and a pack may still write about it. Any literal, rather than only one inside `resolve.conditions`: there is
 * no other reason for a pack's config to name it, and matching the shape would mean guessing at how the
 * property was spelled.
 *
 * A pattern over the pack root rather than a list of filenames, so `vitest.config.js`, a `.mjs` and a
 * `vitest.workspace.ts` are covered — a list of four `.ts` spellings left every JS config unchecked, which is
 * not the shape an external pack is obliged to use. `readSource` reads all of them: `pack-sources.ts`'s
 * `SOURCE_FILE` covers `js|jsx|mjs|cjs`, and a non-`.vue` file is parsed whole.
 */
const PACK_CONFIG = /^(?:vite|vitest)\.(?:config|workspace)\.[cm]?[jt]s$/;

/**
 * `<config>:<line>: <condition>` for each of the pack's configs naming the source condition.
 *
 * The only findings this rule gives an `at`, and so the only ones that claim a site in the one-offence-one-message
 * dedupe — a claim nothing can currently match, because these sit at the pack root while the per-file rules read
 * `src` or `tests`. It is not dead: `check:specifiers` takes paths, so a caller can name the root and put a config
 * in both populations. The rule's other two findings have no `at` on purpose: an unreadable config is a sentence
 * about one, and a resolved path is where a specifier landed, outside the pack, which is evidence and not a place.
 */
export function configsNamingSourceCondition(packDir: string): PackWideFinding[] {
  return fs.readdirSync(packDir).filter((name) => PACK_CONFIG.test(name)).sort().flatMap((name) =>
    readSource(path.join(packDir, name))
      .visit((node) => (ts.isStringLiteralLike(node) && node.text === SOURCE_CONDITION ? [node.text] : undefined))
      .map(({ line, what }) => ({ what, at: { file: name, line } })));
}
