import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CHECKS, findAppImportsInPackTests, findContractLeafImports, findCrossCheckoutResolution, findCrossFeatureImports, findExtensionlessOwnModules, findHostImports, findJsSpecifiers, findMissingSourceConditions, findPackageScriptImports, findPackBackendConsole, findPackWindowStorage, findComponentSends, findPackOwnAliases, findRawGitListings, findRawPackHelpers, findRawTransport, findReservedEventKeys, findInternalPackageImports, findDatabaseImports, findRepositoryCasts, findSharedPackageLists, findSyncSpawnsInSlowSpecs, findUpwardImports, jsSpecifierFixes, LAYERS, UNLAYERED_BY_DESIGN, repoRootDir, findUnimportedDependencies, DATABASE_RULES, MANIFEST_FIELDS, packOwnModuleFixes, packageSourceDirs, CHECK_IDS, type CoveredRuleId, DECLARES_SOURCE_BY_DESIGN, type ImportRuleId, SHARED_LIST_CONSUMERS, sourceConditionPackages, SOURCE_CONDITION, checkedDirs, type ImportRule, packCodeDirs, packDirs, packRule, packRuleProblems, ruleRows, ruleTable } from '../../../scripts/check-import-specifiers.ts';
import { REPO_ROOT } from '@apackdev/host/build/packages-built';
import { packFixture as buildPackFixture } from '@apackdev/sdk/testing/pack-fixture';
import { population } from '@apackdev/sdk/testing';
import { RUNTIME_ONLY_DEPS, workspaceDeps } from '../../../scripts/lib/workspace-deps.ts';
import { filesUnder } from '../../../scripts/lib/import-populations.ts';


/** scripts/check-import-specifiers.ts, over a temp tree holding the modules the checks resolve against */
let root: string;
let written: Set<string>;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'apack-specifiers-'));
  written = new Set();
  for (const [file, content] of Object.entries({
    'query.ts': 'export const q = 1;',
    'view.tsx': 'export const v = 1;',
    'module.mts': 'export const m = 1;',
    'common.cts': 'export const c = 1;',
    'declared.d.ts': 'export declare const d: number;',
  })) write(file, content);
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

/**
 * A file at `file` under the temp root, and **each path once per case**.
 *
 * A second write wins in silence, which is how a case that proves something with two files becomes a case with
 * one. Measured 2026-10-02: renaming the pack fixture's feature folded the per-file-target case below onto a
 * single path, and the only reason it was not a green run testing half of what it claims is that the case
 * happens to assert a count first. The same collapse through an object literal is a typecheck error (TS1117)
 * and a lint error; through two calls here it was nothing at all, in a file that writes some two hundred.
 *
 * A case that means to replace a file it already wrote says so with `rewriteAt`.
 */
function writeAt(file: string, content: string): void {
  if (written.has(file)) {
    throw new Error(`${file} was already written by this case, and a second write would replace it in silence. `
      + 'Two cases of one path is usually a collapsed fixture; use rewriteAt if replacing it is the point.');
  }
  written.add(file);
  rewriteAt(file, content);
}

/** The same write, for the one thing writeAt forbids: replacing a file this case already wrote, on purpose */
function rewriteAt(file: string, content: string): void {
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  fs.writeFileSync(path.join(root, file), content);
}

/** A file under the temp root's src/, which the checks below are pointed at */
function write(file: string, content: string): void {
  writeAt(path.join('src', file), content);
}

/** The same, replacing what a case's own setup wrote: the perturbation a "flags X" case is made of */
function rewrite(file: string, content: string): void {
  rewriteAt(path.join('src', file), content);
}

/**
 * The subpath map a pack fixture declares, which is how a pack names its own modules: `apack pack init` writes one and
 * every own-module specifier in this repo's packs is one. `@/` is not an alternative to it — `findPackOwnAliases`
 * below and the CLI's `pack-own-aliases` both refuse one — so no fixture here writes that spelling except the cases
 * whose subject it is.
 */
const PACK_IMPORTS = { '#features/*': './src/features/*', '#generated/*': './src/__generated__/*' };

function problems(file: string, content: string): string[] {
  write(file, content);
  return findJsSpecifiers(['src'], root);
}

describe('findJsSpecifiers', () => {
  it.each([
    ['import', "import { q } from './query.js';"],
    ['side-effect import', "import './query.js';"],
    ['re-export', "export * from './query.js';"],
    ['dynamic import', "export const load = () => import('./query.js');"],
    ['import type', "export type Q = typeof import('./query.js');"],
    ['import-equals', "import q = require('./query.js');"],
    ['require', "const q = require('./query.js');"],
    ['require.resolve', "const q = require.resolve('./query.js');"],
    ['vi.mock', "vi.mock('./query.js', () => ({}));"],
    ['vi.importActual', "await vi.importActual('./query.js');"],
    ['a .tsx target', "import { v } from './view.js';"],
    ['a .mts target', "import { m } from './module.mjs';"],
    ['a .cts target', "import { c } from './common.cjs';"],
  ])('flags: %s', (_form, code) => {
    expect(problems('consumer.ts', code)).toEqual([expect.stringMatching(/^src\/consumer\.ts:1: \.\//)]);
  });

  it.each(['consumer.tsx', 'consumer.mts', 'consumer.cts'])('checks %s files', (file) => {
    expect(problems(file, "import { q } from './query.js';")).toHaveLength(1);
  });

  it('checks .vue script blocks with their line numbers', () => {
    expect(problems('Widget.vue', "<template><div /></template>\n<script setup lang=\"ts\">\nimport { q } from './query.js';\n</script>\n"))
      .toEqual(['src/Widget.vue:3: ./query.js']);
  });

  it('allows .ts specifiers, declaration-only modules and packages', () => {
    expect(problems('consumer.ts', [
      "import { q } from './query.ts';",
      "import type { d } from './declared.js';",
      "import { x } from 'some-package/x.js';",
      "vi.mock('./missing.js');",
    ].join('\n'))).toEqual([]);
  });
});

/** Code none of the pack rules flag: comments, string text and the allowed imports */
const ALLOWED = [
  "// import { untypedBroadcastToSurface } from '@apackdev/sdk/events'; _rootEvents; trpc.bus; console.log('x')",
  "/* import * as events from '@apackdev/sdk/events'; console.log('x') */",
  "const url = 'https://console.anthropic.com/settings/keys';",
  "const prompt = `_rootEvents.emitOutgoing(event); console.log(ev.type)`;",
  "import { untypedBroadcastToSurface, untypedSendToSystem } from '#generated/events';",
  "import { onConnected, onIncoming } from '@apackdev/sdk/events';",
  "import { emit as emitEvent } from 'xstate';",
  "import * as ears from '@apackdev/ears';",
  "import { x } from '@apackdev/sdk/rpcx';",
  'const { busId } = trpc; trpc.buses.list();',
  "logger.info('saved');",
].join('\n');

describe('findInternalPackageImports', () => {
  it.each([
    ["import { _getMediaPath } from '@apackdev/sdk/utils';", '_getMediaPath from @apackdev/sdk/utils'],
    ["const { _getMediaPath } = await import('@apackdev/sdk/utils');", '_getMediaPath from @apackdev/sdk/utils'],
  ])('flags %s', (code, problem) => {
    write('pack/feature.ts', code);
    expect(findInternalPackageImports(['src/pack'], root)).toEqual([`src/pack/feature.ts:1: ${problem}`]);
  });

  it("flags one a pack's tests import, not only its sources", () => {
    writeAt('tests/unit/content.spec.ts', "import { _getMediaPath } from '@apackdev/sdk/utils';\n");
    expect(findInternalPackageImports(['tests'], root)).toEqual(['tests/unit/content.spec.ts:1: _getMediaPath from @apackdev/sdk/utils']);
  });

  it('allows public names, a public name aliased to an underscore, a pack-local one and other packages', () => {
    write('pack/feature.ts', [
      "import { importCompiledContent, ensureDirectoryExists } from '@apackdev/sdk/utils';",
      "import { formatProviderError as _formatProviderError } from '@apackdev/sdk/actions';",
      "import { _fmt } from './_helpers/format.ts';",
      "import * as utils from '@apackdev/sdk/utils';",
      "import { _ } from 'lodash';",
      ALLOWED,
    ].join('\n'));
    write('pack/__generated__/events.ts', "import { _rootEvents } from '@apackdev/sdk/runtime';\n");
    expect(findInternalPackageImports(['src/pack'], root)).toEqual([]);
  });

  it('holds for the repo', () => {
    expect(findInternalPackageImports()).toEqual([]);
  });
});

describe('findRawPackHelpers', () => {
  it.each([
    ["import { untypedBroadcastToSurface as toSurface } from '@apackdev/sdk/events';", 'untypedBroadcastToSurface from @apackdev/sdk/events'],
    ["import onConnected, { untypedSendToSystem } from '@apackdev/sdk/events';", 'untypedSendToSystem from @apackdev/sdk/events'],
    ["import { untypedBroadcastToSurface, createActionEmitter } from '@apackdev/sdk/services';", 'untypedBroadcastToSurface from @apackdev/sdk/services'],
    ["export type { untypedBroadcastToSurface } from '@apackdev/sdk/events';", 'untypedBroadcastToSurface from @apackdev/sdk/events'],
    ["import * as events from '@apackdev/sdk/events';", '* from @apackdev/sdk/events (import the names)'],
    ["export * from '@apackdev/sdk/events';", '* from @apackdev/sdk/events (import the names)'],
  ])('flags %s', (code, problem) => {
    write('pack/feature.ts', code);
    expect(findRawPackHelpers(['src/pack'], root)).toEqual([`src/pack/feature.ts:1: ${problem}`]);
  });

  it('allows comments, strings and the generated facades, and exempts generated files', () => {
    write('pack/feature.ts', ALLOWED);
    write('pack/__generated__/events.ts', "import { untypedSendToSystem } from '@apackdev/sdk/events';\n");
    expect(findRawPackHelpers(['src/pack'], root)).toEqual([]);
  });

  it('checks .vue script blocks with their line numbers', () => {
    write('pack/Widget.vue', "<template><pre>import { untypedBroadcastToSurface } from '@apackdev/sdk/events'</pre></template>\n<script setup lang=\"ts\">\n\nimport { untypedBroadcastToSurface } from '@apackdev/sdk/events';\n</script>\n");
    expect(findRawPackHelpers(['src/pack'], root)).toEqual(['src/pack/Widget.vue:4: untypedBroadcastToSurface from @apackdev/sdk/events']);
  });
});

describe('findRawTransport', () => {
  it.each([
    ["import { trpc } from '@apackdev/sdk/rpc';", '@apackdev/sdk/rpc'],
    ["const rpc = await import('@apackdev/sdk/rpc/client');", '@apackdev/sdk/rpc/client'],
    ['_rootEvents.emitOutgoing(event);', '_rootEvents'],
    ["trpc.bus.send.mutate({ systemId: 'notes', type: 'GET_NOTES' });", 'trpc.bus'],
    ['trpc?.bus.send.mutate(event);', 'trpc.bus'],
  ])('flags %s', (code, problem) => {
    write('pack/feature.ts', code);
    expect(findRawTransport(['src/pack'], root)).toEqual([`src/pack/feature.ts:1: ${problem}`]);
  });

  it('allows comments, strings and the typed sends, and checks generated files', () => {
    write('pack/feature.ts', ALLOWED);
    write('pack/__generated__/events.ts', "\nimport { _rootEvents } from '@apackdev/sdk/runtime';\n");
    expect(findRawTransport(['src/pack'], root)).toEqual(['src/pack/__generated__/events.ts:2: _rootEvents']);
  });
});

describe('findPackBackendConsole', () => {
  it.each([
    ['features/memos/be/system.ts', "console.log('saved');", 'console.log'],
    ['features/hooks.ts', "console?.warn('init');", 'console.warn'],
    ['migrations/0.4.0.ts', "const x = `${console.info('x')}`;", 'console.info'],
    ['extensions/steps/llm/runtime.ts', "console.debug('prompt');", 'console.debug'],
  ])('flags a console use in %s', (file, code, problem) => {
    write(`pack/${file}`, code);
    expect(findPackBackendConsole(['src/pack'], root)).toEqual([`src/pack/${file}:1: ${problem}`]);
  });

  it('allows comments and string text', () => {
    write('pack/features/memos/be/system.ts', ALLOWED);
    expect(findPackBackendConsole(['src/pack'], root)).toEqual([]);
  });

  it('checks backend paths from the pack src root only', () => {
    for (const file of [
      'features/memos/fe/state.ts',
      'extensions/steps/llm/fe.ts',
      'extensions/register-fe.ts',
      'extensions/tiptap/index.ts',
      'extensions/artifacts/viewers/format.ts',
      'extensions/blocks/display/label.ts',
      'extensions/app/Welcome.vue',
      'features/memos/be/system.spec.ts',
      'features/memos/be/__tests__/helpers.ts',
      'lib/features/memos/be/system.ts',
      'content/actions/run.ts',
    ]) write(`pack/${file}`, "console.log('x');");
    expect(findPackBackendConsole(['src/pack'], root)).toEqual([]);
  });
});

/**
 * Read from the syntax tree, since the rule became the pack rule `apack pack build` runs (`goal-one-rule-set.md`).
 * The case this used to have for a specifier inside a template literal is gone with its subject: the CLI's
 * templates are files now, and in a pack's own source a string that looks like an import is a string.
 */
describe('findHostImports', () => {
  it.each([
    ["import { edgeStore } from '@apackdev/host/ears';", '@apackdev/host/ears'],
    ["import type { PackRegistration } from '@apackdev/host/packs';", '@apackdev/host/packs'],
    ["export { hydrate } from '@apackdev/host/ears';", '@apackdev/host/ears'],
    ["const backup = await import('@apackdev/host/backup');", '@apackdev/host/backup'],
    ["const { envs } = require('@apackdev/host/ears');", '@apackdev/host/ears'],
    ["import '@apackdev/host';", '@apackdev/host'],
  ])('flags %s', (code, specifier) => {
    write('pack/feature.ts', code);
    expect(findHostImports(['src/pack'], root)).toEqual([`src/pack/feature.ts:1: ${specifier}`]);
  });

  it('checks generated files and allows the SDK', () => {
    write('pack/feature.ts', `import { findRelations, untypedQuery } from '@apackdev/sdk/ears';\nimport { services } from '#generated/services';\n${ALLOWED}`);
    write('pack/__generated__/ears.ts', "import { query } from '@apackdev/host/ears';\n");
    expect(findHostImports(['src/pack'], root)).toEqual(['src/pack/__generated__/ears.ts:1: @apackdev/host/ears']);
  });
});

describe('findAppImportsInPackTests', () => {
  it.each([
    ["const { init } = await import('../../../apack-cli/src/commands/init');", '../../../apack-cli/src/commands/init'],
    ["import { installPackFromLocal } from '../../../apack-host/src/packs/pack-installer';", '../../../apack-host/src/packs/pack-installer'],
  ])('flags %s', (code, specifier) => {
    write('pack-tests/unit/feature.spec.ts', code);
    expect(findAppImportsInPackTests(['src/pack-tests'], root)).toEqual([`src/pack-tests/unit/feature.spec.ts:1: ${specifier}`]);
  });

  // What is left for this rule is a relative path into the app's sources, which no pack outside this repo can
  // write. The two shapes it used to claim as well — `@apackdev/host` and a `@/` alias — are rows 1 and 2 of the
  // derived tests-half sweep, which asserts *exactly one* claimant across every rule that reads a pack's tests.
  it('allows the SDK, the harness and the pack itself', () => {
    write('pack-tests/unit/feature.spec.ts', [
      "import { untypedQuery } from '@apackdev/sdk/ears';",
      "import { startApp } from '@apackdev/testing/harness';",
      "import { repository } from '#generated/repository.ts';",
      "import { handler } from '../../src/extensions/steps/llm/runtime';",
      ALLOWED,
    ].join('\n'));
    expect(findAppImportsInPackTests(['src/pack-tests'], root)).toEqual([]);
  });
});

/** A layered package in `root`: its package.json and source files */
function layer(dir: string, manifest: Record<string, unknown>, files: Record<string, string>): void {
  writeAt(path.join(dir, 'package.json'), JSON.stringify({ name: 'x', ...manifest }));
  for (const [file, content] of Object.entries(files)) writeAt(path.join(dir, file), content);
}

describe('findUpwardImports', () => {
  // The five rows the fixture below builds a directory for. These cases are about the mechanism, so a row with
  // no tree behind it would only make the manifest read throw; the real twelve are covered by `holds for the
  // repo` and the two coverage cases at the end of this block.
  const modelled = ['apack-ears', 'apack-sdk', 'apack-host', 'api', 'renderer'];
  const layers = LAYERS.filter((l) => modelled.includes(path.basename(l.dir)))
    .map((l) => ({ ...l, dir: `layers/${path.basename(l.dir).replace(/^apack-/, '')}` }));
  const allowed = () => {
    layer('layers/ears', {}, { 'src/index.ts': "import { x } from './x.ts';\nimport ts from 'typescript';\n" });
    layer('layers/sdk', { dependencies: { '@apackdev/ears': '^0.1.0', yaml: '*' } }, {
      'src/index.ts': "import { untypedWrite } from '@apackdev/sdk/ears';\nexport type { Q } from '@apackdev/ears/lmdb';\nexport * from '@apackdev/sdk/events';\n",
    });
    layer('layers/host', { dependencies: { '@apackdev/ears': '*', '@apackdev/sdk': '*' } }, {
      'src/index.ts': "import { createActionEmitter } from '@apackdev/sdk/services';\nimport { untypedQuery } from '@apackdev/sdk/ears';\nimport { x } from '../x.ts';\n",
      'tests/a.spec.ts': "vi.mock('@apackdev/ears');\n",
    });
    layer('layers/api', { devDependencies: { '@apackdev/ears': '*', '@apackdev/host': '*', '@apackdev/sdk': '*' } }, {
      'src/setup/backend.ts': "import { openLmdbStore } from '@apackdev/ears/lmdb';\nimport { createHostRuntime } from '@apackdev/host/services';\nimport { bindHost } from '@apackdev/sdk/runtime';\n",
    });
    layer('layers/renderer', { dependencies: { '@apackdev/host': '*', '@apackdev/sdk': '*', '@apackdev/ui': '*' } }, {
      'src/main.ts': "import { createFePackRegistry } from '@apackdev/host/fe';\nimport { bindFeHost } from '@apackdev/sdk/runtime';\n",
      'src/App.vue': "<script setup lang=\"ts\">\nimport Button from '@apackdev/ui/design/button';\n</script>\n",
    });
  };

  it('allows imports down the layers', () => {
    allowed();
    expect(findUpwardImports(layers, root)).toEqual([]);
  });

  it.each([
    ['ears', 'src/query.ts', "import { EARS } from '@apackdev/sdk';", 'layers/ears/src/query.ts:1: @apackdev/sdk'],
    ['ears', 'tests/query.spec.ts', "const { startTestRuntime } = await import('@apackdev/sdk/testing');", 'layers/ears/tests/query.spec.ts:1: @apackdev/sdk/testing'],
    ['sdk', 'src/services/app.ts', "import { createHostRuntime } from '@apackdev/host/services';", 'layers/sdk/src/services/app.ts:1: @apackdev/host/services'],
    ['sdk', 'src/fe/ui.ts', "export type { Button } from '@apackdev/ui/design/button';", 'layers/sdk/src/fe/ui.ts:1: @apackdev/ui/design/button'],
    ['host', 'src/bus/app.ts', "import { rootEvents } from '@app/api/core/router/bus-emitter';", 'layers/host/src/bus/app.ts:1: @app/api/core/router/bus-emitter'],
    ['host', 'src/bus/app.ts', "import { rootEvents } from '../../../api/src/core/router/bus-emitter.ts';", 'layers/host/src/bus/app.ts:1: ../../../api/src/core/router/bus-emitter.ts'],
    ['host', 'src/bus/app.ts', "import { logger } from '@/core/shared/debug/logger';", 'layers/host/src/bus/app.ts:1: @/core/shared/debug/logger'],
    ['host', 'scripts/x.ts', "import { cli } from '@apackdev/cli';", 'layers/host/scripts/x.ts:1: @apackdev/cli'],
    ['api', 'src/router.ts', "import Button from '@apackdev/ui/design/button';", 'layers/api/src/router.ts:1: @apackdev/ui/design/button'],
    ['renderer', 'src/store.ts', "import { openLmdbStore } from '@apackdev/ears/lmdb';", 'layers/renderer/src/store.ts:1: @apackdev/ears/lmdb'],
  ])('flags an upward import in %s: %s', (pkg, file, code, problem) => {
    allowed();
    writeAt(path.join('layers', pkg, file), code);
    expect(findUpwardImports(layers, root)).toEqual([problem]);
  });

  it.each([
    ['ears', { peerDependencies: { '@apackdev/sdk': '*' } }, 'layers/ears/package.json: peerDependencies: @apackdev/sdk'],
    ['sdk', { dependencies: { '@apackdev/ears': '*', '@apackdev/host': '*' } }, 'layers/sdk/package.json: dependencies: @apackdev/host'],
    ['host', { dependencies: { '@apackdev/ears': '*', '@apackdev/sdk': '*' }, devDependencies: { '@apackdev/cli': '*' } }, 'layers/host/package.json: devDependencies: @apackdev/cli'],
  ])("flags an @apackdev package %s's manifest may not declare", (pkg, manifest, problem) => {
    allowed();
    rewriteAt(path.join('layers', pkg, 'package.json'), JSON.stringify({ name: 'x', ...manifest }));
    expect(findUpwardImports(layers, root)).toEqual([problem]);
  });

  it.each([
    ['api', { devDependencies: { '@apackdev/ears': '*', '@apackdev/sdk': '*' } }, 'layers/api/package.json: undeclared: @apackdev/host'],
    ['renderer', { dependencies: { '@apackdev/host': '*', '@apackdev/sdk': '*' } }, 'layers/renderer/package.json: undeclared: @apackdev/ui'],
    ['host', { dependencies: { '@apackdev/sdk': '*' } }, 'layers/host/package.json: undeclared: @apackdev/ears'],
  ])('flags an @apackdev package %s imports without declaring it', (pkg, manifest, problem) => {
    allowed();
    rewriteAt(path.join('layers', pkg, 'package.json'), JSON.stringify({ name: 'x', ...manifest }));
    expect(findUpwardImports(layers, root)).toEqual([problem]);
  });

  /**
   * The coverage half, over the real tree — because that is the only place the population lives.
   *
   * `LAYERS` is hand-written and covered five of the twelve workspaces holding code; the seven it missed
   * were missing by omission, not by decision, and nothing said so. These two cases are why that cannot
   * recur: drop a row and the package it layered is reported, excuse one that still has a row and the
   * contradiction is reported. The fixture cases above are unaffected, because a synthetic root has no
   * `packages/` for the population to find.
   */
  it('reports a workspace that holds code and has no layer', () => {
    const short = LAYERS.filter((layer) => layer.dir !== 'packages/preload');
    expect(findUpwardImports(short))
      .toEqual(['packages/preload: holds code and has no layer, so nothing says which @apackdev packages it may import']);
  });

  it('reports a workspace that is both layered and excused', () => {
    const also = [...LAYERS, { name: '@app/default-setup', dir: 'packages/default-setup', allowed: [] }];
    expect(findUpwardImports(also).filter((problem) => problem.startsWith('packages/default-setup:')))
      .toEqual([`packages/default-setup: has a layer and is also excused as "${UNLAYERED_BY_DESIGN.get('packages/default-setup')!}" — drop one`]);
  });

  /**
   * **The direction that asks whether `allowed` is too wide**, which the three above do not.
   *
   * Each of them asks whether a row permits enough; a permission nothing uses is invisible to all three, so a
   * row drifts permissive an entry at a time and a row allowing everything reads like one that earned it.
   * That is what made `@apackdev/cli`'s row a grant rather than a decision when it landed.
   */
  it('reports a permission a row has and imports nowhere', () => {
    allowed();
    const wider = layers.map((l) => (l.name === '@app/api' ? { ...l, allowed: [...l.allowed, '@apackdev/ui'] } : l));
    expect(findUpwardImports(wider, root))
      .toEqual(['layers/api: allows @apackdev/ui and imports it nowhere, so the permission grants nothing']);
  });

  // The reason comes from RUNTIME_ONLY_DEPS, which `workspaceDeps` reads too — a permission is unused because
  // its dependency is a process dependency, so one record answers both
  it('reports a reason for a permission that is now used', () => {
    allowed();
    const WHY = 'kept for the packaged app rather than for an import';
    const runtimeOnly = new Map([['layers/api @apackdev/ears', WHY]]);
    expect(findUpwardImports(layers, root, UNLAYERED_BY_DESIGN, runtimeOnly))
      .toEqual([`layers/api: imports @apackdev/ears, so its unusedBecause ("${WHY}") no longer applies`]);
  });

  // The third clause the sibling exemption lists carry too: an entry whose
  // workspace is gone, or holds no code, excuses nothing and should say so rather than sit there
  // Over the real root, because the clause needs a population to check an entry against: under the synthetic
  // tree there are no workspaces at all, and an entry excusing nothing is indistinguishable from an entry
  // whose workspace this root has never heard of
  it('reports an excused workspace that holds no code', () => {
    const WHY = 'a pack, governed by the pack rules';
    const unlayered = new Map([...UNLAYERED_BY_DESIGN, ['packages/not-here', WHY]]);
    expect(findUpwardImports(LAYERS, repoRootDir(), unlayered))
      .toEqual([`packages/not-here: listed in UNLAYERED_BY_DESIGN (${WHY}) but it holds no code, or is gone`]);
  });

  it('holds for the repo', () => {
    expect(findUpwardImports()).toEqual([]);
  });
});

/**
 * `workspaceDeps` reads manifests to answer "what does this package compile", which is a guess about someone
 * else's code — a proxy, and this repo's rule is that a proxy needs a self-check. This is it, in the direction
 * nothing asked: a declaration no import needs, which silently widens every cache key derived from it.
 *
 * The list is read twice, which is why the last case sits here rather than beside `workspaceDeps`: the same
 * entry that excuses a declaration is the one that keeps it out of the key.
 */
describe('findUnimportedDependencies', () => {
  const WHY = 'spawned by path, not imported';

  it('reports an entry no manifest declares any more', () => {
    const stale = new Map([...RUNTIME_ONLY_DEPS, ['packages/main @apackdev/nope', WHY]]);
    expect(findUnimportedDependencies(repoRootDir(), stale))
      .toEqual([`packages/main @apackdev/nope: listed in RUNTIME_ONLY_DEPS (${WHY}) but no manifest declares it`]);
  });

  it('reports an entry whose package imports it after all', () => {
    const stale = new Map([...RUNTIME_ONLY_DEPS, ['packages/main @apackdev/sdk', WHY]]);
    expect(findUnimportedDependencies(repoRootDir(), stale))
      .toEqual([`packages/main: imports @apackdev/sdk, so its RUNTIME_ONLY_DEPS entry (${WHY}) no longer applies`]);
  });

  // The other reader. Without it `typecheck:main` declared 1868 files, 195 of them from packages main imports
  // nothing from, against 52 of its own source
  it('keeps a process dependency out of the cache key', () => {
    expect(workspaceDeps('main')).not.toContain('apack-cli');
    expect(workspaceDeps('main'), 'the deps main really compiles').toContain('apack-host');
    expect([...RUNTIME_ONLY_DEPS.keys()]).toContain('packages/main @apackdev/cli');
  });

  it('holds for the repo', () => {
    expect(findUnimportedDependencies()).toEqual([]);
  });
});

describe('filesUnder', () => {
  // A build stages its output under the pack's `.apack/`, and a test run writes `results/`, while other steps read
  // the tree: neither is source, and walking them reads files that can vanish between the listing and the read
  it('lists a package\'s source and not what tools write beside it', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'files-under-'));
    try {
      for (const file of ['pkg/src/a.ts', 'pkg/.apack/staged/b.ts', 'pkg/results/c.ts', 'pkg/dist/d.js']) {
        fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
        fs.writeFileSync(path.join(root, file), 'export {};\n');
      }
      expect(filesUnder(['pkg'], root).map((file) => path.relative(root, file))).toEqual([path.join('pkg', 'src', 'a.ts')]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('findDatabaseImports', () => {
  // The rules with their directories under the temp root's src/
  const rules = DATABASE_RULES.map((rule) => ({
    ...rule,
    dirs: rule.dirs.map((dir) => `src/${dir}`),
    except: rule.except && `src/${rule.except}`,
  }));
  const allowed = () => {
    write('packages/apack-ears/src/lmdb/database.ts', "import { Database } from 'elmdb';\nimport type { EarsDatabase } from '../database.ts';\n");
    write('packages/apack-ears/src/sqlite/database.ts', "import Database from 'better-sqlite3';\nimport { getLoadablePath } from 'sqlite-vec';\n");
    write('packages/apack-ears/src/index.ts', "export { untypedWrite } from './write.ts';\n");
    write('packages/apack-host/src/services/app-data.ts', "import type { DatabaseOptions } from '@apackdev/ears/lmdb';\n");
    write('packages/api/src/setup/backend.ts', "import { openDatabase } from '@apackdev/ears/lmdb';\n");
    write('packages/default-setup/src/features/notes/be/system.ts', "import { untypedWrite } from '@apackdev/sdk/ears';\n");
  };

  it('allows @apackdev/ears/lmdb to load elmdb, and the host and the API to open a database through it', () => {
    allowed();
    expect(findDatabaseImports(rules, root)).toEqual([]);
  });

  it.each([
    ['packages/apack-host/src/services/run-history.ts', "import { Database } from 'elmdb';"],
    ['packages/apack-host/tests/store.spec.ts', "const elmdb = await import('elmdb');"],
    ['packages/api/src/setup/backend.ts', "import type { Database } from 'elmdb';"],
    ['packages/api/scripts/db/fix.ts', "const { Database } = require('elmdb/index.js');"],
    ['packages/apack-ears/src/index.ts', "export { openDatabase } from './lmdb/index.ts';"],
    ['packages/apack-ears/src/engine.ts', "import type { DatabaseOptions } from './lmdb/database.ts';"],
    ['packages/apack-ears/src/query.ts', "import { Database } from 'elmdb';"],
    ['packages/apack-ears/src/index.ts', "export { openDatabase } from './sqlite/index.ts';"],
    ['packages/apack-ears/src/index.ts', "export { openDatabase } from '@apackdev/ears/sqlite';"],
    ['packages/apack-ears/src/index.ts', "export { openDatabase } from '@apackdev/ears/lmdb';"],
    ['packages/apack-ears/src/query.ts', "import Database from 'better-sqlite3';"],
    ['packages/apack-host/src/services/app-data.ts', "import { getLoadablePath } from 'sqlite-vec';"],
    ['packages/default-setup/src/features/notes/be/system.ts', "import { openDatabase } from '@apackdev/ears/sqlite';"],
    ['tests/packs/external-pack/tests/unit/memos.spec.ts', "vi.mock('better-sqlite3');"],
    ['packages/default-setup/src/features/notes/be/system.ts', "import { openDatabase } from '@apackdev/ears/lmdb';"],
    ['tests/packs/external-pack/tests/unit/memos.spec.ts', "vi.mock('elmdb');"],
  ])('flags %s', (file, code) => {
    allowed();
    rewrite(file, code);
    expect(findDatabaseImports(rules, root)).toEqual([expect.stringMatching(new RegExp(`^src/${file}:1: `))]);
  });

  /**
   * The one repo-only rule that *runs* a pack rule: `DATABASE_RULES`' pack entry names a key and `findDatabaseImports`
   * delegates to it, so that key and the one the parity table advertises are two records of one fact. The case
   * that puts the offence in a pack cannot see them diverge — `packRule(by)` still fires on the fixture when the
   * routing is changed — so this compares the two records directly.
   */
  it('routes its pack population to the pack rule the parity table names', () => {
    const parity = CHECKS.find((rule) => rule.id === 'findDatabaseImports')?.repoOnly;
    if (parity?.kind !== 'covered') throw new Error('findDatabaseImports no longer names a pack rule that covers it');
    const routed = [...new Set(DATABASE_RULES.flatMap((rule) => (rule.rule === undefined ? [] : [rule.rule])))];
    expect(routed, 'no DATABASE_RULES entry delegates to a pack rule, so the parity note names a rule nothing runs')
      .not.toEqual([]);
    expect(routed, `the pack population is checked by these, while --list tells a pack author it is \`${parity.by}\``)
      .toEqual([parity.by]);
  });

  it('holds for the repo', () => {
    expect(findDatabaseImports()).toEqual([]);
  });
});

describe('findSharedPackageLists', () => {
  it.each([
    ["const EXTERNALS = ['@apackdev/sdk', '@apackdev/sdk/*'];", ['"@apackdev/sdk"', '"@apackdev/sdk/*"']],
    ["if (source.startsWith('@apackdev/ears/')) return;", ['"@apackdev/ears/"']],
    ['bridge({ bridgedPackages: [`@apackdev/ears`] });', ['"@apackdev/ears"']],
  ])('flags a shared package named outside an import: %s', (code, found) => {
    write('consumer.ts', code);
    expect(findSharedPackageLists(['src/consumer.ts'], root)).toEqual(found.map((what) => `src/consumer.ts:1: ${what}`));
  });

  it('allows imports of the packages and their specific modules', () => {
    write('consumer.ts', [
      "import { untypedWrite } from '@apackdev/sdk/ears';",
      "export * from '@apackdev/sdk';",
      "const sdk = await import('@apackdev/sdk');",
      "const runtime = resolve('@apackdev/sdk/runtime');",
      "// '@apackdev/sdk' in a comment",
      "const message = 'packs import @apackdev/sdk instead';",
    ].join('\n'));
    expect(findSharedPackageLists(['src/consumer.ts'], root)).toEqual([]);
  });

  it('holds for every consumer of SHARED_INSTANCE_PACKAGES', () => {
    for (const file of SHARED_LIST_CONSUMERS) expect(fs.existsSync(path.join(REPO_ROOT, file)), file).toBe(true);
    expect(findSharedPackageLists()).toEqual([]);
  });
});

/**
 * Every rule in `CHECKS` is a gate that fails the build, so every one needs a case that proves it bites.
 *
 * **A sentence cannot hold that, which is why the table below is read rather than described.** A file that
 * imports `CHECKS` and never reads it leaves the convention to whoever remembers it, and two rules reached
 * the tree with no case at all that way (`findPackOwnAliases`, `findPackageScriptImports`). Same shape as
 * `step-build-barrel.spec.ts`: a table and its uses, kept in step by a test.
 */
/**
 * One offending example per rule in `CHECKS`, and the call that runs the rule over it.
 *
 * Every rule there is a gate that fails the build, so every one needs a case that proves it bites — and the
 * two attempts before this one read the *spec* instead of running the rules. The first asked whether a
 * `describe` block existed, which the own-module rule satisfied while half of it was asserted nowhere. The
 * second parsed this file and asked what each block's assertions looked like, which `expect([1]).toEqual([1])`
 * inside a well-named `describe` would have satisfied, and which called `findSharedPackageLists` uncovered
 * because its cases build their expected list instead of writing it out.
 *
 * So this runs each rule against input written to make it speak. The table is keyed by the rule's function
 * name and checked against `CHECKS` in both directions, so a rule added without an example fails here, and an
 * example left behind by a deleted rule fails too. The per-rule `describe` blocks above cover the nuances:
 * what each rule allows, the line it reports, the forms it reads. This covers one thing, for all of them.
 */
/**
 * The tree every pack-code rule's example sits in: a package that is also a pack, which is what
 * `packages/default-setup` is — so the rules whose population is `packages/*` and the rules whose population is a
 * pack's halves can be pointed at the same directory.
 *
 * One shape, because there used to be two and the difference was invisible. A fixture at `src/pack` has no
 * `package.json` and no `apack.json`, so `own-modules` (which needs the `imports` map) and `contract-leaves`
 * (which needs the manifest) **cannot fire there at all** — measured. Half the sweep's fixtures were that shape,
 * so for those rows those two rules' "and no other rule claims it" said nothing: they were not able to claim.
 *
 * The base is clean, asserted below, so a sweep attributes nothing to the tree it runs in.
 */
const PACK_FIXTURE = 'packages/demo-pack';
const PACK_SRC = [`${PACK_FIXTURE}/src`];
const PACK_TESTS = [`${PACK_FIXTURE}/tests`];

/** The shared complete pack, written where these rules' populations look for one */
function packFixture(files: Record<string, string> = {}): void {
  buildPackFixture({ at: path.join(root, PACK_FIXTURE), files });
}

/** The same table read by id-as-a-string, for the sweeps, which derive their ids from the widened `CHECKS` */
const exampleFor = (id: string): (() => string[]) | undefined =>
  (FIRES as Record<string, () => string[]>)[id];

const FIRES: Record<ImportRuleId, () => string[]> = {
  findJsSpecifiers: () => {
    write('f.ts', "import { q } from './query.js';");
    return findJsSpecifiers(['src'], root);
  },
  findRawPackHelpers: () => {
    packFixture({ 'src/f.ts': "import { untypedSendToSystem } from '@apackdev/sdk/events';" });
    return findRawPackHelpers(PACK_SRC, root);
  },
  findInternalPackageImports: () => {
    packFixture({ 'src/f.ts': "import { _getMediaPath } from '@apackdev/sdk/utils';" });
    return findInternalPackageImports(PACK_SRC, root);
  },
  findComponentSends: () => {
    // A feature's component, which is the half the rule is scoped to — an extension's is exempt, and
    // `pack-rules.spec.ts` holds that half
    packFixture({ 'src/features/memos/fe/panel.vue': "<script setup lang=\"ts\">\nsendToSurface('notes', { type: 'X' });\n</script>" });
    return findComponentSends(PACK_SRC, root);
  },
  findRawTransport: () => {
    packFixture({ 'src/f.ts': '_rootEvents.emitOutgoing(event);' });
    return findRawTransport(PACK_SRC, root);
  },
  findReservedEventKeys: () => {
    // The key a delivery door writes, written by the pack instead — where it is overwritten on the way in
    packFixture({ 'src/f.ts': "export const answer = { type: 'DONE', _call: mine };" });
    return findReservedEventKeys(PACK_SRC, root);
  },
  findPackBackendConsole: () => {
    packFixture({ 'src/features/memos/be/system.ts': "console.log('written');" });
    return findPackBackendConsole(PACK_SRC, root);
  },
  findPackWindowStorage: () => {
    packFixture({ 'src/features/memos/fe/state.ts': "const raw = localStorage.getItem('open-tabs');" });
    return findPackWindowStorage(PACK_SRC, root);
  },
  findHostImports: () => {
    packFixture({ 'src/f.ts': "import { edgeStore } from '@apackdev/host/ears';" });
    return findHostImports(PACK_SRC, root);
  },
  findPackOwnAliases: () => {
    packFixture({ 'src/f.ts': "import { x } from '@/features/memos/be/x.ts';" });
    return findPackOwnAliases(PACK_SRC, root);
  },
  findExtensionlessOwnModules: () => {
    // Both forms this rule owns. The `#` one alone left its relative branch with no repo-side example at all,
    // which is how that branch stayed broken here while a pack author's own build reported it
    packFixture({ 'src/f.ts': "import { sendToSystem } from '#generated/events';\nimport { sibling } from './sibling.js';" });
    return findExtensionlessOwnModules(PACK_SRC, root);
  },
  findAppImportsInPackTests: () => {
    packFixture({ 'tests/unit/feature.spec.ts': "import { hydrate } from '../../../apack-host/src/database/store';" });
    return findAppImportsInPackTests(PACK_TESTS, root);
  },
  findUpwardImports: () => {
    // Only the rows this tree builds a directory for: one with no tree behind it makes the manifest read throw
    const modelled = ['apack-ears', 'apack-sdk', 'apack-host', 'api', 'renderer'];
    const layers = LAYERS.filter((l) => modelled.includes(path.basename(l.dir)))
      .map((l) => ({ ...l, dir: `layers/${path.basename(l.dir).replace(/^apack-/, '')}` }));
    // Every layer has to be there, since the rule walks all of them; only the lowest one imports upward
    const upward = { 'src/index.ts': "import { createActionEmitter } from '@apackdev/sdk/services';\n" };
    for (const { dir } of layers) layer(dir, {}, dir === 'layers/ears' ? upward : {});
    return findUpwardImports(layers, root);
  },
  findUnimportedDependencies: () => {
    // A real workspace name, because that is what makes a specifier a workspace dependency; the source file is
    // what puts this package in the population at all, and it imports nothing
    writeAt('packages/demo/package.json', JSON.stringify({ name: '@app/demo', dependencies: { '@apackdev/sdk': '*' } }));
    writeAt('packages/demo/src/index.ts', 'export const x = 1;\n');
    return findUnimportedDependencies(root, new Map());
  },
  findDatabaseImports: () => {
    const rules = DATABASE_RULES.map((rule) => ({
      ...rule,
      dirs: rule.dirs.map((dir) => `src/${dir}`),
      except: rule.except && `src/${rule.except}`,
    }));
    write('packages/apack-host/src/services/run-history.ts', "import { Database } from 'elmdb';");
    return findDatabaseImports(rules, root);
  },
  findRawGitListings: () => {
    write('caller.ts', "execFileSync('git', ['ls-files']);");
    return findRawGitListings(['src'], root, {});
  },
  findSyncSpawnsInSlowSpecs: () => {
    // Aliased, so the case also shows the import is read by its exported name
    write('slow.integration.spec.ts', "import { execFileSync as run } from 'node:child_process'; run('true');");
    return findSyncSpawnsInSlowSpecs([path.join(root, 'src', 'slow.integration.spec.ts')], root, {});
  },
  findSharedPackageLists: () => {
    write('consumer.ts', "const EXTERNALS = ['@apackdev/sdk'];");
    return findSharedPackageLists(['src/consumer.ts'], root);
  },
  findRepositoryCasts: () => {
    packFixture({ 'src/f.ts': 'const notes = repository as unknown as Repositories;' });
    return findRepositoryCasts(PACK_SRC, root);
  },
  findCrossFeatureImports: () => {
    packFixture({ 'src/extensions/viewer.ts': "import List from '../features/memos/fe/canvas/list.vue';" });
    return findCrossFeatureImports(PACK_SRC, root);
  },
  findContractLeafImports: () => {
    // Both shapes this rule reports: the leaf's own import, and one reached through its closure, which is the
    // only one that carries a `from` — so a consumer rewriting the paths of a finding that names two of them
    // has something to be wrong about. `.ts` on the sibling and a type-only generated import keep the site to
    // one claimant, since this fixture is swept for exactly that
    packFixture({
      'src/features/memos/fe/contract.ts': "import type { P } from './surface.ts';",
      'src/features/memos/be/contract.ts': "import type { Ev } from './children/list.ts';",
      'src/features/memos/be/children/list.ts': "import type { Ev } from '#generated/events.ts';",
    });
    return findContractLeafImports(PACK_SRC, root);
  },
  findPackageScriptImports: () => {
    writeAt('packages/thing/package.json', JSON.stringify({ name: '@apackdev/thing' }));
    writeAt('packages/thing/scripts/build.ts', "import { x } from '../../../scripts/lib/x.ts';");
    return findPackageScriptImports(root);
  },
  findCrossCheckoutResolution: () => {
    // A worktree nested in the repository: its own build output is missing, so TypeScript keeps walking up
    // and resolves the package to the parent checkout's
    const outer = path.join(root, 'outer');
    const inner = path.join(outer, 'nested', 'worktree');
    for (const checkout of [outer, inner]) {
      writeAt(path.relative(root, path.join(checkout, 'package.json')), JSON.stringify({ name: 'root', workspaces: ['packages/*'] }));
      writeAt(path.relative(root, path.join(checkout, 'packages', 'api', 'package.json')), JSON.stringify({ name: '@app/api', types: 'dist/types.d.ts' }));
      fs.mkdirSync(path.join(checkout, 'node_modules', '@app'), { recursive: true });
      fs.symlinkSync(path.join(checkout, 'packages', 'api'), path.join(checkout, 'node_modules', '@app', 'api'), 'dir');
    }
    writeAt(path.relative(root, path.join(outer, 'packages', 'api', 'dist', 'types.d.ts')), 'export {};\n');
    return findCrossCheckoutResolution(inner);
  },
  findMissingSourceConditions: () => {
    workspace();
    writeAt('packages/consumer/tsconfig.json', '{ "compilerOptions": { "strict": true } }');
    return conditionProblems();
  },
};

/**
 * The offence each `covered` rule is about, written as pack code, and what the pack rule it names must report.
 *
 * `covered: { by }` claims an external pack is held to this rule's subject under another name, and `by:
 * PackRuleKey` checks only that the key exists — pointing `findDatabaseImports` at `backend-console` compiled, printed
 * in `--list` and left all 243 cases green. So the claim is shown rather than asserted: the offence goes into a
 * pack, and the named rule has to be the one that reports it.
 *
 * Keyed by `CoveredRuleId`, derived from the entries, so a rule that starts claiming coverage without evidence
 * does not compile. The three relationships underneath differ — `database-imports` is run by its repo rule for the
 * pack population, `own-modules` takes over a population its repo rule excludes, and `source-resolution` refuses
 * the same pack config from outside this repo — but what has to hold is one thing, so it is one table.
 */
const COVERED_BY: Record<CoveredRuleId, { files: Record<string, string>; finding: string }> = {
  // The base fixture writes `src/sibling.ts`, which is what makes the `.js` resolvable-but-wrong
  findJsSpecifiers: {
    files: { 'src/f.ts': "import { sibling } from './sibling.js';\n" },
    finding: "packages/demo-pack/src/f.ts:1: './sibling.js' names no file — write './sibling.ts'",
  },
  findDatabaseImports: {
    files: { 'src/f.ts': "import { Database } from 'elmdb';\n" },
    finding: 'packages/demo-pack/src/f.ts:1: elmdb',
  },
  // Its config route, which reads the pack root's own listing — so the config goes there, not under a subdirectory
  findMissingSourceConditions: {
    files: { 'vitest.config.ts': `export default { resolve: { conditions: ['${SOURCE_CONDITION}'] } };\n` },
    finding: `packages/demo-pack/vitest.config.ts:1: ${SOURCE_CONDITION}`,
  },
};

/**
 * Which half of a pack a rule's declared population reads, taken from `over` rather than a list written here.
 *
 * This is what makes the sweeps below cover whoever arrives: a rule that reads a pack's `src` is swept there, one
 * that reads its `tests` is swept there, and one whose population holds no pack dir at all — `findJsSpecifiers`,
 * whose subject is the packages that are *not* packs — takes part in neither, which is the exclusion its own
 * disjointness case asserts from the other side.
 */
const readsPackHalf = (rule: ImportRule, half: 'src' | 'tests'): boolean =>
  (rule.over ?? []).some((dir) => path.basename(dir) === half && packDirs().includes(path.dirname(dir)));

/** The rules a sweep over `half` runs: the ones that read it and can be pointed at a directory */
const sweepers = (half: 'src' | 'tests'): readonly ImportRule[] =>
  CHECKS.filter((rule) => readsPackHalf(rule, half) && rule.overPaths !== undefined);

/** Every rule but `id` that also claims the offence sitting in `dirs` */
const alsoClaiming = (id: string, dirs: readonly string[], half: 'src' | 'tests'): string[] =>
  sweepers(half).filter((rule) => rule.id !== id && rule.overPaths!([...dirs], root).length > 0).map((rule) => rule.id);


/**
 * The walk behind `packDirs` is memoised, and the memo is keyed on this repo's root and nothing else.
 *
 * That condition is the whole of its safety, so it gets the case the cache it replaces never had. A walk
 * cannot be keyed on content — a directory's mtime moves when its own entries do, not when something three
 * levels down changes — so the alternative was a reset hatch, and `resetSourceCache()` is the one two specs
 * remember and the largest spec here did not, which is why it was quadratic until `7c4b8aacc`.
 */
describe("this checkout's pack list", () => {
  it('walks again for a tree that is not this repo, so a pack written after the first call is found', () => {
    const tree = fs.mkdtempSync(path.join(os.tmpdir(), 'pack-dirs-'));
    try {
      for (const name of ['one', 'two']) {
        fs.mkdirSync(path.join(tree, name), { recursive: true });
        fs.writeFileSync(path.join(tree, name, 'apack.json'), '{}');
        // Asked after each, so the second answer has a first one to be stale against
        expect(packDirs(tree), 'a memo ignoring the root would still be answering with the first walk')
          .toContain(name);
      }
    } finally {
      fs.rmSync(tree, { recursive: true, force: true });
    }
  });

  // 103 286 readdirSync calls became 5 366, and `check:specifiers` 4.6s -> 2.5s, because the rules ask
  // about 189 times and the repo does not grow a pack while they do
  it('walks this repo once, however often it is asked', () => {
    expect(packDirs()).toBe(packDirs());
  });
});

describe('CHECKS', () => {
  /**
   * That each rule *fires* — the half a type cannot state. `FIRES` is keyed by `ImportRuleId`, derived from
   * `CHECKS`, so a rule with no example and an example for a rule that is gone are both compile errors now,
   * naming the id and suggesting the one it meant. What is left here is the assertion that the example is not a
   * fiction: a gate with no case that makes it speak is a gate nothing has watched fail.
   */
  it.each(CHECK_IDS)('%s flags an offending example', (name) => {
    expect(FIRES[name](), `${name} found nothing in a tree written to offend it`).not.toEqual([]);
  });

  /**
   * `--list`'s parity column, asserted one row at a time.
   *
   * A row is the only place a rule's id and its answer sit together, and that pairing is the whole point of the
   * column — so the claim has to be about *this* row. Asserted over the command's stdout instead, rendering every
   * rule with the next rule's key left the table saying `findRawPackHelpers -> internal-package-imports` and the
   * whole suite green, because every string was still somewhere in the output.
   */
  it('lists a rule, and never another rule, in each rule\'s own answer', () => {
    const rows = ruleRows();
    expect(CHECKS.length, 'no rules, so this would pass over nothing').toBeGreaterThan(0);
    expect(rows.map((row) => row.id), '--list reaches a different set of rules than the runner does')
      .toEqual(CHECKS.map((rule) => rule.id));

    for (const rule of CHECKS) {
      const cell = rows.find((row) => row.id === rule.id)!.parity;
      // The key it names, rather than whether the key appears: a cell naming two, or naming the neighbour's,
      // is what this is here to catch, and `toContain` cannot tell either from the right answer
      expect(cell.match(/`([^`]+)`/)?.[1], `${rule.id}'s row names the wrong pack rule`).toBe(rule.packRule);
      if (rule.packRule === undefined) expect(cell, `${rule.id} is this repo's alone and its row must say so`).toMatch(/^no\b/);
    }
  });

  /**
   * The gap, kept closed.
   *
   * `unenforced` is the answer for a rule a pack can break while nothing outside this repo refuses it, and it
   * has no members — `repository-casts` was the last and is a pack rule now. The variant stays because without
   * it the next such rule has nowhere honest to go: whoever adds it reaches for `inapplicable`, a claim no check
   * can contradict, and the gap reopens in silence. If the work seems to need a row here, that is a decision to
   * raise rather than take.
   */
  it('lists no rule a pack can break while only this repo checks it', () => {
    const repoOnly = CHECKS.filter((rule) => rule.repoOnly !== undefined);
    expect(repoOnly.length, 'no rule is this repo\'s alone, so this would pass over nothing').toBeGreaterThan(0);
    expect(repoOnly.filter((rule) => rule.repoOnly!.kind === 'unenforced').map((rule) => rule.id),
      'an external pack can break this and nothing refuses it — move it to PACK_RULES, or say which kind it really is')
      .toEqual([]);
  });

  it('has evidence for every rule that claims a pack rule covers it, and for no other', () => {
    const covered = CHECKS.filter((rule) => rule.repoOnly?.kind === 'covered').map((rule) => rule.id);
    population('the covered parity entries', covered);
    expect(Object.keys(COVERED_BY).sort(), 'COVERED_BY and the entries disagree about which rules claim coverage')
      .toEqual([...covered].sort());
  });

  it.each(Object.entries(COVERED_BY))('%s is held for a pack by the rule it names', (id, { files, finding }) => {
    const parity = CHECKS.find((rule) => rule.id === id)?.repoOnly;
    if (parity?.kind !== 'covered') throw new Error(`${id} no longer claims a pack rule covers it, so this row is stale`);
    packFixture(files);
    expect(packRule(parity.by, PACK_SRC, root),
      `${id} says an external pack is held to this as \`${parity.by}\`, but that rule does not report the offence in a `
      + 'pack written to commit it — so the rule named is not the rule that covers it').toEqual([finding]);
  });

  /**
   * "The rule is the same rule wherever it runs" is what `pack-rules.ts` opens by claiming, and it was false:
   * the two runners each built a rule's `PackPlace` by hand, and two of the five fields had drifted, so
   * `own-modules` reported a relative `.js` to a pack author and nothing at all here.
   *
   * Asserted over each rule's own example, which `exampleFor` both writes and runs through the repo's entry
   * point. `packRuleProblems` is what `apack pack build` calls, and prints pack-relative where this prints
   * repo-relative, which is the one difference between them that is meant to exist.
   */
  it.each([...sweepers('src')].map((rule) => rule.id))('%s reports the same offence to a pack author and to this repo', (id) => {
    const key = CHECKS.find((rule) => rule.id === id)!.packRule!;
    const viaRepo = exampleFor(id)!();
    // A pack author's build runs every rule and drops a finding whose span another rule already claimed; this
    // runs one. The disjointness case above is what says no fixture here has two claimants, so nothing is
    // dropped and the two are comparable. `packRule` sorts its findings and `packRuleProblems` does not.
    const viaPack = packRuleProblems(path.join(root, PACK_FIXTURE)).get(key) ?? [];
    expect(viaPack, `${id}'s example offends nothing when a pack author builds it`).not.toEqual([]);
    // `replaceAll`: a finding that names two paths carries the prefix twice — `contract-leaves` writes
    // `… (reached from <path>)` — and stripping only the first reads as a rule disagreeing with itself
    expect(viaRepo.map((line) => line.replaceAll(`${PACK_FIXTURE}/`, '')).sort(),
      `${id} reports a different offence to a pack author than to this repo, so the rule is not the same rule `
      + 'wherever it runs').toEqual([...viaPack].sort());
  });

  /**
   * And a run pointed below a half still reports what a run over the half reports.
   *
   * `check:specifiers <paths>` takes a file or a directory — CLAUDE.md offers "one feature" — and `inRoot` used
   * to be measured from whatever the caller named, so the two rules that read it as a path shape matched
   * nothing. Both fail open, so the per-path mode ran fewer rules than it claimed and nothing complained.
   *
   * Derived from the rules and from their own findings rather than from the pair I remembered: the guard that
   * replaced this named `backend-console` and missed `cross-feature-imports`, which was broken identically.
   * Every sweeper's finding carries a path — `packRule` writes `<file>:<line>: <what>`, and a whole-pack finding
   * carries one whenever it has an `at`, which `contractLeafFindings` always sets — so the file to point at is
   * read back out of the finding instead of being listed beside the fixture.
   *
   * `toContain`, because a whole-pack rule answers for the pack however the run is pointed and so yields a
   * superset. What has to hold either way is that the offence does not disappear.
   */
  it.each([...sweepers('src')].map((rule) => rule.id))('%s reports its offence wherever the run is pointed', (id) => {
    const key = CHECKS.find((rule) => rule.id === id)!.packRule!;
    const whole = population(`${id}'s findings over the half`, exampleFor(id)!());
    for (const finding of whole) {
      const file = /^(.+?):\d+: /.exec(finding)?.[1];
      expect(file, `${id} reports a finding with no path, so there is nowhere to point a run at`).toBeDefined();
      for (const target of [file!, path.dirname(file!)]) {
        expect(packRule(key, [target], root),
          `${id} reports this under ${PACK_SRC[0]} and not under ${target}, so what it finds depends on what the `
          + 'run was pointed at rather than on what the pack says').toContain(finding);
      }
    }
  });

  /**
   * And it reads the file it was pointed at, not the pack around it.
   *
   * The case above cannot see this: every sweeper's example puts its offence in one file, so "the findings for
   * that file" and "all the findings" are the same list however exactly it asserts. Measured — with `packPlaces`
   * made to walk the whole pack for a file target, all 267 cases passed. Two offending files is what tells them
   * apart, and one rule is enough, because the walk is a single code path every rule shares.
   */
  it('reads the file it was pointed at and not the pack around it', () => {
    packFixture({
      'src/features/memos/be/system.ts': "console.log('one');",
      'src/features/calendar/be/system.ts': "console.log('two');",
    });
    const both = packRule('backend-console', PACK_SRC, root);
    expect(both, 'both offences must be reported over the half, or pointing at one of them proves nothing')
      .toHaveLength(2);
    const [first] = both;
    expect(packRule('backend-console', [/^(.+?):\d+: /.exec(first!)![1]!], root),
      'pointing at one file reported more than that file, so a per-path run reads the pack and the mode that '
      + 'exists to be cheap is not').toEqual([first]);
  });

  /** And every rule reaches the printed table, under a header, one line each */
  it('prints a header and one line per rule', () => {
    const lines = ruleTable(ruleRows());
    expect(lines).toHaveLength(CHECKS.length + 1);
    expect(lines[0]).toMatch(/^rule\s+paths\?\s+a pack too\?\s+what it reports$/);
    for (const [index, rule] of CHECKS.entries()) {
      expect(lines[index + 1], `${rule.id} is missing from the table`).toMatch(new RegExp(`^${rule.id}\\s`));
    }
  });

  /**
   * And no offence claimed twice. This is the bug that hid behind the old runner: a relative `.js` in pack code
   * was reported by both `findJsSpecifiers` and the own-module rule, and since the runner exited on the first
   * failure, only one was ever read. Resolved by narrowing `findJsSpecifiers` to the packages, where there is
   * no `imports` map to resolve against — and asserted here so the next overlap fails instead of hiding.
   *
   * Bounded by the examples, honestly: it runs the pack-code rules over each pack-code fixture, which is where
   * the overlap was. A rule that reads the whole tree cannot be pointed at a fixture (its scope is the repo's
   * layers, configs and exception lists), so it is not in this sweep.
   *
   * **Every pack-backed rule is a row.** The sweep is what `check-import-specifiers.ts` cites for running one rule
   * at a time, so a rule the CLI owns that is missing here makes that claim wider than the sweep — which is what
   * `cross-feature-imports` and `contract-leaves` did on arriving.
   */
  it.each([...sweepers('src')].map((rule) => rule.id))('%s claims its own example and no other pack rule does', (id) => {
    expect(exampleFor(id)!(), `${id} must fire on its own example`).not.toEqual([]);
    expect(alsoClaiming(id, PACK_SRC, 'src'),
      `${id}'s offence is also reported by these, so only the first to run is ever read`).toEqual([]);

    // And the key the entry declares is the rule that fires. `backed(id, key, find, over)` takes the key twice
    // over — once as `key`, which picks the sentence printed above the findings, and once inside `find`, which is
    // what actually runs — so a mismatch prints one rule's wording over another rule's offences. Nothing else
    // notices: the ownership guard below asks only that a key is declared, not that it is this one.
    //
    // And a key is always there to check, because every rule that reads a pack's `src` is one the CLI owns. That
    // is what moving the last one established: a rule swept here without a key would be one this repo holds its
    // own packs to while an external pack is free of it, which is the gap, not an exemption from this case.
    const declared = CHECKS.find((rule) => rule.id === id)?.packRule;
    expect(declared, `${id} reads a pack's src and names no pack rule, so an external pack is not held to it`).toBeDefined();
    expect(packRule(declared!, PACK_SRC, root),
      `${id} declares \`${declared}\`, which finds nothing in a tree written to offend ${id}: the key it names is `
      + 'not the rule it runs, so its findings print under the wrong sentence').not.toEqual([]);
  });

  /**
   * `findJsSpecifiers` is not in that sweep, and this is why: it and the own-module rule report the same
   * relative `.js`, and what keeps them apart is not the finding but the *population* — packages that are not
   * packs, against packs. A fixture directory plays both roles at once, so both fire there; in the repo they
   * cannot, and that is the property worth asserting. `packages/default-setup` is the case that matters: it is
   * a package *and* a pack, and before the exclusion both rules reported its every `.js` with only the first
   * printed.
   */
  it('gives findJsSpecifiers and the own-module rule disjoint populations', () => {
    const packs = packDirs();
    expect(packs, 'the packs are derived from where a manifest is, so this should never be empty').not.toEqual([]);
    const overlap = checkedDirs().filter((dir) => packs.some((pack) => dir === pack || dir.startsWith(`${pack}/`)));
    expect(overlap, 'a pack\'s own code belongs to own-modules, which names the file to write').toEqual([]);
  });


  /**
   * The population a rule about a pack's own code reads. A rule that covered `src` alone was narrower in this repo
   * than the same rule is for a pack, since `apack pack test` runs the set over a pack's `tests` — which is how
   * `@apackdev/host` in a pack's test came to be reported by a third rule instead of the one that owns it.
   */
  it("covers every pack's src and its tests", () => {
    const packs = packDirs();
    expect(packs, 'the packs are derived from where a manifest is, so this should never be empty').not.toEqual([]);
    const missing = packs.flatMap((pack) => ['src', 'tests']
      .filter((half) => fs.existsSync(path.join(REPO_ROOT, pack, half)) && !packCodeDirs().includes(`${pack}/${half}`))
      .map((half) => `${pack}/${half}`));
    expect(missing, 'a pack half that exists and is not in the population is a tree no such rule reads').toEqual([]);
  });

  /**
   * Playwright's output directories are not a pack's tests. It writes and removes `tests/results` *during* a
   * run, so a walk that descends into one races it — a chain run whose E2E suite overlapped `test:integration`
   * failed with ENOENT on a directory that existed when it was listed. Two of them also sit inside the fixture
   * packs, where every pack rule would read a trace dump as that pack's own test sources.
   *
   * Written over a temp tree rather than the repo, because what the repo holds at any moment is what the last
   * Playwright run left behind: asking it would pass on a clean checkout and say nothing.
   */
  it('finds no pack inside a test-output directory', () => {
    fs.mkdirSync(path.join(root, 'real'), { recursive: true });
    fs.writeFileSync(path.join(root, 'real/apack.json'), '{}');
    for (const buried of ['tests/results/trace-1', 'real/tests/results/trace-2', 'test-results/trace-3']) {
      fs.mkdirSync(path.join(root, buried), { recursive: true });
      fs.writeFileSync(path.join(root, buried, 'apack.json'), '{}');
    }
    // The scaffold's template pack is appended rather than walked to, so it is here whatever the tree holds
    expect(packDirs(root)).toEqual(['packages/apack-cli/templates/pack', 'real']);
  });

  /**
   * The one shape two pack rules are both right about, and the two consumers answer differently on purpose.
   *
   * `apack pack validate` runs every rule together, so its dedupe gives a pack author one message — asserted in
   * `apack-cli/tests/build/pack-rules.spec.ts`. `packRule` here runs one rule at a time, because `--rule <id>`
   * has to answer for that rule alone and an answer that depended on which other rules ran would not be one. So
   * this side reports both, and that is the difference, not a bug: pinned so nobody 'fixes' one to match the other.
   */
  it('reports a leaf reaching another feature under both rules, running one rule at a time', () => {
    writeAt('pack/apack.json', JSON.stringify({
      id: 'demo-pack', name: 'Demo', version: '1.0.0',
      features: { memos: { surface: { label: 'Fixture', state: 'src/features/memos/fe/surface.ts', contract: 'src/features/memos/fe/contract.ts#Contract' } } },
    }));
    writeAt('pack/src/features/memos/fe/contract.ts', "import type { T } from '../../calendar/fe/state.ts';\nexport type Contract = { state: { t: T } };");
    writeAt('pack/src/features/memos/fe/surface.ts', 'export type P = { id: string };');
    writeAt('pack/src/features/calendar/fe/state.ts', 'export type T = { id: string };');
    const offence = 'pack/src/features/memos/fe/contract.ts:1: ../../calendar/fe/state.ts';
    expect(findContractLeafImports(['pack/src'], root)).toEqual([offence]);
    expect(findCrossFeatureImports(['pack/src'], root)).toEqual([offence]);
  });

  /**
   * What makes the sweep above mean anything: the tree it runs in offends nobody, so a claim it reports came from
   * the case's own offending file. Without this, a base that tripped a rule would look like every other rule
   * double-claiming every offence.
   */
  /**
   * Every offence, at every place a rule discriminates on — because the sweep above runs each rule's *own*
   * minimal example, and both overlaps this rule set has had needed a file satisfying **two** rules'
   * preconditions at once. Neither existed in any fixture: the leaf that reaches another feature was found by
   * hand after several commits, and the fixtures that could not fire were found by hand too.
   *
   * The places are read off what the rules test before they report — `place.generated`, `BACKEND_PATH` over
   * `inRoot`, inside a feature against outside every one, and the roles `apack.json` names — and the offences
   * are one line each, lifted from the examples above. The cross product is what finds an intersection nobody
   * thought of, which is the whole point: a hand-written list of "pairs that can collide" would be the same
   * guess as the fixtures it replaces.
   *
   * Specifiers are `#` subpaths, never relative, so one line means the same thing in every cell — a `../` would
   * resolve differently per place and the matrix would be comparing different offences.
   *
   * Most cells are silent, which is correct: an offence only fires where its rule's preconditions hold.
   */
  /** Where a file can sit, one per property the rules test before they report. The half is the path's first segment. */
  const PLACES: Record<string, string> = {
    'a contract leaf (fe)': 'src/features/memos/fe/contract.ts',
    'a contract leaf (be)': 'src/features/memos/be/contract.ts',
    'an actor entry': 'src/features/memos/be/system.ts',
    "a feature's fe": 'src/features/memos/fe/panel.ts',
    "a feature's be": 'src/features/memos/be/helper.ts',
    'outside every feature': 'src/extensions/viewer.ts',
    generated: 'src/__generated__/thing.ts',
    'the tests half': 'tests/unit/feature.spec.ts',
  };

  /** One offending line per rule, in `#` subpaths so the same text means the same thing at every place */
  const OFFENCES: Record<string, string> = {
    'host-imports': "import { edgeStore } from '@apackdev/host/ears';",
    'database-imports': "import { Database } from 'elmdb';",
    'internal-package-imports': "import { _getMediaPath } from '@apackdev/sdk/utils';",
    'untyped-sends': "import { untypedSendToSystem } from '@apackdev/sdk/events';",
    'raw-transport': '_rootEvents.emitOutgoing(event);',
    'backend-console': "console.log('written');",
    'pack-own-aliases': "import { x } from '@/features/memos/be/x.ts';",
    'own-modules': "import { sendToSystem } from '#generated/events';",
    'repository-casts': 'const notes = repository as unknown as Repositories;',
    'cross-feature-imports': "import { t } from '#features/calendar/fe/state.ts';",
    'contract-leaves': "import type { P } from '#features/memos/fe/surface.ts';",
  };

  /** A second feature for the cross-feature offence to name. Inert, and in every cell so they are all alike. */
  const SECOND_FEATURE = { 'src/features/calendar/fe/state.ts': 'export const t = 1;\n' };

  /**
   * An unrelated offence elsewhere in every cell's pack, which must survive whatever the cell's own offence does.
   *
   * Without it the dedupe's other failure is invisible here: a drop only happens where two rules claim one site,
   * and every such cell is recorded in ACCEPTED_OVERLAP, so a dedupe that suppressed far too much would pass.
   * Measured — made to drop every per-file finding in a pack holding any whole-pack claim, the sweep did not
   * notice until this was here.
   */
  const DECOY = {
    src: 'src/decoy.ts',
    tests: 'tests/decoy.spec.ts',
  } as const;
  const DECOY_FILES = Object.fromEntries(Object.values(DECOY)
    .map((file) => [file, "import { edgeStore } from '@apackdev/host/ears';\n"]));

  /**
   * A cell two rules both claim, with the verdict a reader can check. Hand-written, because a real overlap needs a
   * human decision — and asserted still to overlap below, so one the dedupe has since been taught to merge cannot
   * sit here. A new row is a decision to raise, not to take.
   *
   * These say *claimed*, not *reported*: this sweep runs one rule at a time, where `packRuleProblems` merges them
   * for a pack author. Which rule wins each is pinned in `apack-cli/tests/build/pack-rules.spec.ts`.
   */
  const ACCEPTED_OVERLAP: Record<string, { winner: string; why: string }> = {
    'cross-feature-imports at a contract leaf (fe)': { winner: 'contract-leaves', why: 'both word it as the specifier' },
    'cross-feature-imports at a contract leaf (be)': { winner: 'contract-leaves', why: 'both word it as the specifier' },
    // Found by this matrix: `own-modules` words its finding as a sentence around the specifier, so keyed on the
    // wording the dedupe saw two offences and told a pack author twice about one import. Merged since a finding
    // carries a `subject` — what it is about, beside how it reads.
    'own-modules at a contract leaf (fe)': { winner: 'contract-leaves', why: "merged on the finding's subject" },
    'own-modules at a contract leaf (be)': { winner: 'contract-leaves', why: "merged on the finding's subject" },
  };

  const places = population('places', Object.entries(PLACES), { atLeast: 6 });
  const offences = population('offences', Object.entries(OFFENCES), { atLeast: 8 });
  const cells = places.flatMap(([where, file]) => offences.map(([offence, code]) => ({ where, file, offence, code })));

  /**
   * Every offence at every place, because the sweep above runs each rule's *own* example and both overlaps this
   * rule set has had needed a file meeting **two** rules' preconditions at once — a shape no minimal example has.
   * The cross product finds the intersection nobody thought of, which a hand-written list of "pairs that can
   * collide" would not.
   *
   * One case over all of them: 88 would be 88 task updates, and the reporter the cost record is measured through
   * times out under that. Collecting also names every overlapping cell at once rather than the first.
   */
  it('claims each offence under at most one rule, at every place a rule discriminates on', async () => {
    // Hoisted: `sweepers` asks `packDirs()`, which walks the repo for manifests. Per rule per cell that was 29s of
    // the 30 this case first took.
    const sweepersFor = { src: [...sweepers('src')], tests: [...sweepers('tests')] };
    const firing: string[] = [];
    const overlapping: string[] = [];
    const mismatched: string[] = [];
    const accepted = new Set<string>();

    for (const [n, { where, file, offence, code }] of cells.entries()) {
      // Per cell, for the reason the hook above gives: this case alone is 22s of synchronous work, and one
      // block that long is a third of birpc's window before the box has any other load on it
      await new Promise<void>((resolve) => { setImmediate(resolve); });
      /**
       * A pack of its own per cell, under a *name* of its own — and removed once the cell is done.
       *
       * The name must be unique: `readSource` caches by absolute path and never invalidates, so reusing one
       * path serves the previous cell's source, which is the reading that made an earlier attempt at sharing
       * one pack find none of the four overlaps it finds this way.
       *
       * They must also not accumulate. Every rule's `overPaths` calls `packDirs(root)`, which walks the tree
       * for manifests, so cell *N* was re-walking the N-1 packs before it, twelve times over — measured,
       * 0.20ms at one pack against 15.65ms at eighty-eight, which is 8.4s of this case and grows with the
       * square of the cell count. Hoisting `sweepers` removed one of the two walks; this removes the other.
       */
      const at = `${PACK_FIXTURE}-${n}`;
      buildPackFixture({ at: path.join(root, at), files: { [file]: `${code}\n`, ...SECOND_FEATURE, ...DECOY_FILES } });
      // What this cell adds, so a cell that found something keeps its tree: the assertions are collected and
      // made at the end, by which time the directory a reader would want to look at is otherwise gone
      const found = overlapping.length + mismatched.length;
      try {
        // Pointed at the file, not the half, so the rules share one parse instead of each walking the pack.
        // `packRootOf` still finds the pack above it, so the manifest and the imports map are still in reach.
        const half = file.startsWith('tests/') ? 'tests' : 'src';
        const claimed = sweepersFor[half]
          .filter((rule) => rule.overPaths!([`${at}/${file}`], root).length > 0)
          .map((rule) => rule.packRule ?? rule.id);
        const key = `${offence} at ${where}`;
        if (claimed.length > 1) {
          if (ACCEPTED_OVERLAP[key] === undefined) overlapping.push(`${key}: ${claimed.sort().join(' and ')}`);
          else accepted.add(key);
        }
        if (claimed.length === 0) continue;
        firing.push(key);

        // And what a pack author is actually told. `packRuleProblems` runs the rules together and drops a finding
        // another rule already claimed, which is the half this sweep cannot see: it runs one rule at a time, so a
        // rule that claims here and is silent there was dropped by the dedupe. Rule keys, not lines — the two
        // runners spell a path differently on purpose.
        const told = [...packRuleProblems(path.join(root, at), [half])];
        const reported = told
          .filter(([, found]) => found.some((line) => line.startsWith(`${file}:`)))
          .map(([rule]) => rule as string);

        // The unrelated offence must survive whatever the cell's own does: a drop only happens where two rules
        // claim one site, and every such cell is accepted below, so without this a dedupe suppressing far too much
        // would pass. One decoy per half, since a run over `tests` never sees the one in `src`.
        if (!told.some(([rule, found]) => rule === 'host-imports' && found.some((line) => line.startsWith(`${DECOY[half]}:`)))) {
          mismatched.push(`${key}: the unrelated offence in ${DECOY[half]} went with it, so the dedupe drops too much`);
        }
        const added = reported.filter((rule) => !claimed.includes(rule));
        const dropped = claimed.filter((rule) => !reported.includes(rule));
        if (added.length > 0) mismatched.push(`${key}: ${added.join(', ')} told a pack author and claimed by nothing`);
        const merge = ACCEPTED_OVERLAP[key];
        if (dropped.length > 0 && merge === undefined) {
          mismatched.push(`${key}: ${dropped.join(', ')} claims the offence and no pack author hears it`);
        }
        // And the winner a recorded merge names is the rule an author actually hears, so the verdict is checked
        // rather than believed
        if (merge !== undefined && reported.join() !== merge.winner) {
          mismatched.push(`${key}: recorded as \`${merge.winner}\` winning, and a pack author hears ${reported.join(', ') || 'nothing'}`);
        }
      } finally {
        if (overlapping.length + mismatched.length === found) {
          fs.rmSync(path.join(root, at), { recursive: true, force: true });
        }
      }
    }

    population('cells where some rule claims the offence', firing, { atLeast: 8 });
    expect(overlapping, 'each is one offence two rules claim, so which a reader is told depends on precedence — '
      + 'fix it, or record the pair in ACCEPTED_OVERLAP with the verdict').toEqual([]);
    expect(mismatched, 'a rule claims an offence that reaches a pack author under another rule or under none: the '
      + 'dedupe is dropping or re-attributing findings the one-rule-at-a-time run says are there').toEqual([]);
    expect(Object.keys(ACCEPTED_OVERLAP).filter((key) => !accepted.has(key)),
      'these no longer report one offence under two rules, so drop them from ACCEPTED_OVERLAP').toEqual([]);
  });

  it('offends no rule before a case adds an offence', () => {
    packFixture();
    const claimed = [...sweepers('src')].filter((rule) => rule.overPaths!(PACK_SRC, root).length > 0).map((rule) => rule.id);
    expect(claimed, 'the shared fixture is not clean, so a sweep attributes its noise to whichever rule it is sweeping').toEqual([]);
  });

  /** And every rule that reads a pack's src is swept, derived from what each declares rather than listed here */
  it("sweeps every rule that reads a pack's src", () => {
    const swept = [...sweepers('src')].map((rule) => rule.id);
    expect(swept.length, 'no rule declares a population holding a pack\'s src, so the sweep runs over nothing').toBeGreaterThan(5);
    expect(swept.filter((id) => exampleFor(id) === undefined),
      'a swept rule with no offending example in FIRES cannot be checked for double-claiming').toEqual([]);
  });

  /**
   * The other population, and nothing swept it: `apack pack test` runs the whole rule set over a pack's `tests`
   * (`refusePackRuleViolations(cwd, TEST_DIRS)`), so an offence there has an owner exactly as one in `src` does.
   * Three rules claimed `@apackdev/host` in a pack's test until `f04775d70`, and this is the case that would have
   * said so — the fixtures live in `tests/`, where a src sweep cannot reach.
   */
  it.each([
    ['@apackdev/host', "import { hydrate } from '@apackdev/host/ears';", 'findHostImports'],
    ['a @/ alias', "import { openAppStore } from '@/setup/backend';", 'findPackOwnAliases'],
    ['an @internal export', "import { _getMediaPath } from '@apackdev/sdk/utils';", 'findInternalPackageImports'],
    ['the app by relative path', "import { hydrate } from '../../../apack-host/src/database/store';", 'findAppImportsInPackTests'],
    ['an extensionless own module', "import { sendToSystem } from '#generated/events';", 'findExtensionlessOwnModules'],
  ])("in a pack's tests, %s is claimed by exactly one rule", (_shape, code, owner) => {
    packFixture({ 'tests/unit/feature.spec.ts': code });
    const claimed = [...sweepers('tests')].filter((rule) => rule.overPaths!(PACK_TESTS, root).length > 0).map((rule) => rule.id);
    expect(claimed, 'one offence, one owner — in a pack\'s tests as in its src').toEqual([owner]);
  });
});

/**
 * A pack names its own modules by the file that is there. Two forms fail the same way — nothing, and the
 * `.js` a pack never emits — so they get one rule and one message, and the search that names the file the
 * author meant is the one `apack pack build` runs over every pack outside this checkout.
 */
describe('findExtensionlessOwnModules', () => {
  /** A pack with an `imports` map, which is what makes a `#` string a specifier rather than a colour */
  function pack(files: Record<string, string>): void {
    writeAt('pack/package.json', JSON.stringify({ name: 'p', type: 'module', imports: { '#generated/*': './src/__generated__/*' } }));
    writeAt('pack/src/__generated__/events.ts', 'export const sendToSystem = 1;');
    for (const [file, content] of Object.entries(files)) writeAt(`pack/${file}`, content);
  }
  const problems = () => findExtensionlessOwnModules(['pack/src', 'pack/tests'], root);

  it.each([
    ['extensionless', '#generated/events'],
    ['the emitted extension of a TypeScript module', '#generated/events.js'],
  ])('flags a specifier naming no file: %s', (_form, specifier) => {
    pack({ 'src/f.ts': `import { sendToSystem } from '${specifier}';` });
    expect(problems()).toEqual([`pack/src/f.ts:1: '${specifier}' names no file — write '#generated/events.ts'`]);
  });

  it('passes the form that names the file, in the pack and in its tests', () => {
    pack({
      'src/f.ts': "import { sendToSystem } from '#generated/events.ts';",
      'tests/f.spec.ts': "import { sendToSystem } from '#generated/events.ts';",
    });
    expect(problems()).toEqual([]);
  });

  it('reads a pack authored in JavaScript, which nothing requires a pack not to be', () => {
    writeAt('pack/package.json', JSON.stringify({ name: 'p', type: 'module', imports: { '#generated/*': './src/__generated__/*' } }));
    writeAt('pack/src/__generated__/events.ts', 'export const a = 1;');
    writeAt('pack/src/f.js', "import { a } from '#generated/events';");
    expect(findExtensionlessOwnModules(['pack/src'], root))
      .toEqual(["pack/src/f.js:1: '#generated/events' names no file — write '#generated/events.ts'"]);
  });

  it('names a .json target, which a bundler resolves and Node wants an attribute for', () => {
    writeAt('pack/package.json', JSON.stringify({ name: 'p', type: 'module', imports: { '#data/*': './src/data/*' } }));
    writeAt('pack/src/data/providers.json', '{}');
    writeAt('pack/src/f.ts', "import providers from '#data/providers';");
    expect(findExtensionlessOwnModules(['pack/src'], root))
      .toEqual(["pack/src/f.ts:1: '#data/providers' names no file — write '#data/providers.json'"]);
  });
});

/**
 * The other half of two rules: the finder computes the repair and `applyFixes` splices it
 * (`specifier-fixes.spec.ts` covers the writing, and the refusals that make it safe). Nothing covered the
 * finders, and what that cost was `packOwnModuleFixes` deriving the pack with `path.dirname` — right only when
 * the caller names a pack's `src`, so the same offence reached by a nested directory or by the file itself
 * computed no repair at all and reported it as nothing to fix.
 *
 * So every case here names more than one target for one offence: what a caller points the fixer at is the axis
 * that was wrong, and a fixture with the offence directly under `src` cannot see it.
 */
describe('the repairs the rules compute', () => {
  /** A pack whose one offending specifier sits deep enough that the pack is not the parent of what is named */
  function offendingPack(): void {
    writeAt('pack/package.json', JSON.stringify({ name: 'p', type: 'module', imports: { '#generated/*': './src/__generated__/*' } }));
    writeAt('pack/src/__generated__/events.ts', 'export const sendToSystem = 1;');
    writeAt('pack/src/features/memos/f.ts', "import { sendToSystem } from '#generated/events';");
  }

  /** What the file actually holds where a fix says to splice, which is what `applyFixes` writes over */
  const spanOf = ({ file, start, end }: { file: string; start: number; end: number }): string =>
    fs.readFileSync(path.join(root, file), 'utf-8').slice(start, end);

  it.each(['pack/src', 'pack/src/features', 'pack/src/features/memos', 'pack/src/features/memos/f.ts'])(
    'packOwnModuleFixes answers alike for %s', (target) => {
      offendingPack();
      expect(packOwnModuleFixes([target], root)).toEqual([{
        file: 'pack/src/features/memos/f.ts',
        line: 1,
        start: expect.any(Number),
        end: expect.any(Number),
        specifier: '#generated/events',
        named: '#generated/events.ts',
      }]);
    });

  it.each(['packages/thing/src', 'packages/thing/src/nested', 'packages/thing/src/nested/consumer.ts'])(
    'jsSpecifierFixes answers alike for %s', (target) => {
      writeAt('packages/thing/src/nested/query.ts', 'export const q = 1;');
      writeAt('packages/thing/src/nested/consumer.ts', "import { q } from './query.js';");
      expect(jsSpecifierFixes([target], root)).toEqual([{
        file: 'packages/thing/src/nested/consumer.ts',
        line: 1,
        start: expect.any(Number),
        end: expect.any(Number),
        specifier: './query.js',
        named: './query.ts',
      }]);
    });

  // The seam with the writer: a fix is a span plus what to put there, and a span that does not hold the
  // specifier the fix names is one `applyFixes` refuses — which reads as "nothing to fix" from the command
  it('gives spans that hold the specifier each names', () => {
    offendingPack();
    writeAt('packages/thing/src/nested/query.ts', 'export const q = 1;');
    writeAt('packages/thing/src/nested/consumer.ts', "import { q } from './query.js';");
    const fixes = [...packOwnModuleFixes(['pack/src'], root), ...jsSpecifierFixes(['packages/thing/src'], root)];
    expect(fixes.length, 'the fixture offends both rules, so neither walk found no files').toBe(2);
    expect(fixes.map(spanOf)).toEqual(fixes.map((fix) => fix.specifier));
  });
});

/**
 * `@/…` is a TypeScript-only mapping: it resolved for `tsc` and for four bundler configs that each carried
 * their own implementation of it, all of which are gone. A reintroduced one fails quietly, which is why the
 * rule exists.
 */
describe('findPackOwnAliases', () => {
  it('flags a @/ specifier in a pack, and passes the # form', () => {
    writeAt('pack/src/a.ts', "import { x } from '@/features/memos/be/x.ts';");
    writeAt('pack/src/b.ts', "import { y } from '#features/memos/be/y.ts';");
    expect(findPackOwnAliases(['pack/src'], root)).toEqual(['pack/src/a.ts:1: @/features/memos/be/x.ts']);
  });

  /**
   * This rule owns the spelling, and for a long time it was not the only rule that reacted to one: the two that
   * walk a pack's own imports *resolved* `@/` — a spelling this rule and the CLI's `pack-own-aliases` both refuse —
   * and their fixtures were written in it, so every test was green while both were blind to the `#` subpaths the
   * packs write. They resolve through one `packTargetOf` now, and this is the pair of halves: what refuses the
   * spelling reports it, and what resolves specifiers does not resolve it at all.
   */
  it('is the only rule that reacts to one, the resolvers skipping it', () => {
    writeAt('pack/apack.json', JSON.stringify({
      id: 'demo-pack', name: 'Demo', version: '1.0.0',
      features: { memos: { surface: { contract: 'src/features/memos/fe/contract.ts#Contract' } } },
    }));
    writeAt('pack/src/features/memos/fe/contract.ts', "import type { P } from '@/__generated__/fe';");
    writeAt('pack/src/features/code/fe/panel.ts', "import { id } from '@/features/memos/fe/state';");
    expect(findPackOwnAliases(['pack/src'], root).sort()).toEqual([
      'pack/src/features/code/fe/panel.ts:1: @/features/memos/fe/state',
      'pack/src/features/memos/fe/contract.ts:1: @/__generated__/fe',
    ]);
    expect(findCrossFeatureImports(['pack/src'], root)).toEqual([]);
    expect(findContractLeafImports(['pack/src'], root)).toEqual([]);
  });
});

/**
 * A module under the repo's `scripts/` belongs to no package, so `npm run spec` cannot route a change to it
 * back to the spec that covers it — a package's own `scripts/` therefore stays inside the package and its
 * declared dependencies.
 */
describe('findPackageScriptImports', () => {
  /** A package with a scripts/ directory, which is the only shape this rule looks at */
  function pkg(deps: Record<string, string>, files: Record<string, string>, field = 'dependencies'): void {
    writeAt('packages/thing/package.json', JSON.stringify({ name: '@apackdev/thing', [field]: deps }));
    writeAt('packages/thing/src/own.ts', 'export const own = 1;');
    for (const [file, content] of Object.entries(files)) writeAt(`packages/thing/${file}`, content);
  }

  it('passes the package\'s own source, a declared dependency and a builtin', () => {
    pkg({ esbuild: '*' }, { 'scripts/build.ts': "import { own } from '../src/own.ts';\nimport * as fs from 'node:fs';\nimport esbuild from 'esbuild';" });
    expect(findPackageScriptImports(root)).toEqual([]);
  });

  // Every field a manifest declares a dependency in, from the list both rules read: this restated three of the
  // four and dropped `optionalDependencies`, which nothing noticed because no package in this repo declares one.
  // Derived, so a field added to `MANIFEST_FIELDS` is covered the day it lands and one removed fails here.
  it.each(MANIFEST_FIELDS)('takes a dependency declared in %s', (field) => {
    pkg({ esbuild: '*' }, { 'scripts/build.ts': "import esbuild from 'esbuild';" }, field);
    expect(findPackageScriptImports(root)).toEqual([]);
  });

  it('flags a dependency no field declares', () => {
    pkg({}, { 'scripts/build.ts': "import esbuild from 'esbuild';" });
    expect(findPackageScriptImports(root)).toEqual(['packages/thing/scripts/build.ts:1: esbuild']);
  });

  it('flags a reach outside the package and an undeclared dependency', () => {
    pkg({}, { 'scripts/build.ts': "import { x } from '../../../scripts/lib/x.ts';\nimport { y } from '@apackdev/host/build/discover';" });
    expect(findPackageScriptImports(root)).toEqual([
      'packages/thing/scripts/build.ts:1: ../../../scripts/lib/x.ts',
      'packages/thing/scripts/build.ts:2: @apackdev/host/build/discover',
    ]);
  });
});
/**
 * A contract leaf is what codegen reads a feature's events and state from, as a declared type, without resolving
 * the actor they describe. `#generated/events` imports both contracts and both actors import `#generated/events`,
 * so a leaf that can reach its actor closes that cycle — which is why the rule is a closure walk and not a check
 * of the leaf's own imports.
 *
 * The fixture is a pack, `apack.json` included: that file is what makes a tree a pack, and a fixture without one
 * isn't testing the thing the rule runs on.
 */
/**
 * The CLI's scaffold is a pack with no manifest, and `packDirs()` names it outright because the walk that finds
 * every other pack cannot see it — `apack.json` is built in code, from computed keys (`init.ts`).
 *
 * That made it the one pack whose rules ran against the wrong directory: `packRootOf` climbed past it to
 * `packages/apack-cli` and handed that package to every rule, so `contract-leaves` found no features,
 * `cross-feature-imports` read the wrong package's published entry points, and `own-modules` read an `imports`
 * map belonging to someone else. All three reported nothing, and none of them because the scaffold was clean.
 */
describe("the CLI's scaffold, a pack with no manifest", () => {
  const TEMPLATE = 'packages/apack-cli/templates/pack';
  const scaffold = (files: Record<string, string>) => {
    // The CLI's own `package.json`, which is the whole point: without something above the scaffold to find,
    // the walk runs out of tree and lands on the scaffold by accident, and a fixture built that way passes
    // whether the fix is there or not — measured, by removing the fix and watching it stay green
    writeAt('packages/apack-cli/package.json', JSON.stringify({ name: '@apackdev/cli' }));
    for (const [file, content] of Object.entries(files)) writeAt(`${TEMPLATE}/${file}`, content);
  };

  it('is checked by the rules that need no manifest', () => {
    scaffold({
      'src/features/memos/be/contract.ts': "import type { M } from './system.ts';\nexport type Contract = { m: M };\n",
      'src/features/memos/be/system.ts': 'export type M = 1;\n',
      'src/features/memos/be/sibling.ts': 'export const y = 1;\n',
      'src/features/memos/be/relative.ts': "import { y } from './sibling.js';\nexport const z = y;\n",
    });
    expect(packRule('contract-leaves', [`${TEMPLATE}/src`], root),
      'contract-leaves reads the layout where no manifest names the contracts, and the scaffold has none')
      .not.toEqual([]);
    expect(packRule('own-modules', [`${TEMPLATE}/src`], root),
      "own-modules' relative branch needs nothing but the file beside it").not.toEqual([]);
  });

  /**
   * The one exclusion, and it is a fact about the scaffold rather than a choice: a `#` specifier is resolved
   * through the pack's `package.json` `imports`, which `init` writes and the template therefore has none of.
   * Contrasted against a pack that does carry the map, so this says "the scaffold cannot" rather than "nothing
   * here fires".
   */
  it("is not checked by own-modules' # branch, for want of a package.json to resolve through", () => {
    const offence = "import { w } from '#generated/events';\nexport const v = w;\n";
    scaffold({ 'src/features/memos/be/hash.ts': offence });
    expect(packRule('own-modules', [`${TEMPLATE}/src`], root)).toEqual([]);

    packFixture({ 'src/f.ts': offence });
    expect(packRule('own-modules', PACK_SRC, root),
      'the same specifier in a pack that declares an imports map must fire, or this proves nothing')
      .not.toEqual([]);
  });
});

describe('findContractLeafImports', () => {
  const src = 'pack/src';
  /** A pack whose `memos` feature names both contracts, as a real manifest does, with the subpath map a pack has */
  function pack(files: Record<string, string>): void {
    const under = Object.fromEntries(Object.entries(files).map(([file, content]) => [`src/${file}`, content]));
    buildPackFixture({ at: path.join(root, 'pack'), files: under });
  }

  it('allows a leaf that names only its own types and the generated leaves', () => {
    pack({
      'features/memos/fe/contract.ts': [
        "import type { NoteDTO } from '../be/types';",
        "import type { EARS } from '#generated/ears.ts';",
        "import type { X } from '#generated/types.ts';",
      ].join('\n'),
      'features/memos/be/contract.ts': "import type { Incoming } from './types';",
      'features/memos/be/types.ts': 'export type Incoming = { type: "A" };',
    });
    expect(findContractLeafImports([src], root)).toEqual([]);
  });

  /**
   * The surface and system definitions, which the manifest names outright. The machine rule beside this one is a
   * guess at a filename; surface.state now names the machine explicitly. This case deliberately gives it
   * an unconventional filename, so the declaration must determine the forbidden import.
   */
  it("flags a leaf that imports an entry apack.json names, whatever the file is called", () => {
    pack({
      'features/memos/fe/contract.ts': "import type { P } from './surface';",
      'features/memos/be/contract.ts': 'export type Contract = { outgoing: { type: "A" } };',
      'features/memos/fe/surface.ts': 'export type P = { id: string };',
    });
    const manifestFile = path.join(root, 'pack', 'apack.json');
    const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
    manifest.features.memos.surface.state = 'src/features/memos/fe/surface.ts';
    fs.writeFileSync(manifestFile, JSON.stringify(manifest));
    expect(findContractLeafImports([src], root)).toEqual([`${src}/features/memos/fe/contract.ts:1: ./surface`]);
  });

  // It is the entry's path that matters, not its name: a pack whose machine is `machine.ts` is caught the same way
  it('flags an entry the manifest names under an unconventional filename', () => {
    writeAt('pack/apack.json', JSON.stringify({
      id: 'demo-pack', name: 'Demo', version: '1.0.0',
      features: {
        memos: { surface: { label: 'Fixture', state: 'src/features/memos/fe/machine.ts', contract: 'src/features/memos/fe/contract.ts#Contract' } },
      },
    }));
    writeAt(`${src}/features/memos/fe/contract.ts`, "import type { M } from './machine';");
    writeAt(`${src}/features/memos/fe/machine.ts`, 'export type M = { id: string };');
    expect(findContractLeafImports([src], root)).toEqual([`${src}/features/memos/fe/contract.ts:1: ./machine`]);
  });

  // Each side's machine: a surface's is fe/state, a system's is be/system, and both import #generated/events.
  // The rule resolves what it reads, so the machines have to exist for the import to be one.
  it("flags a leaf that reaches its own feature's machine", () => {
    pack({
      'features/memos/fe/contract.ts': "import type { Ctx } from './state';",
      'features/memos/fe/state.ts': "import { sendToSurface } from '#generated/events.ts';",
      'features/memos/be/contract.ts': "import type { Ev } from './system';",
      'features/memos/be/system.ts': "import { untypedBroadcastToSurface } from '#generated/events.ts';",
    });
    expect(findContractLeafImports([src], root).sort()).toEqual([
      `${src}/features/memos/be/contract.ts:1: ./system`,
      `${src}/features/memos/fe/contract.ts:1: ./state`,
    ]);
  });

  it('flags a leaf that names another feature', () => {
    pack({
      'features/memos/fe/contract.ts': "import type { T } from '#features/calendar/be/types.ts';",
      'features/calendar/be/types.ts': 'export type T = { id: string };',
      'features/memos/be/contract.ts': 'export type Contract = { outgoing: { type: "A" } };',
    });
    expect(findContractLeafImports([src], root)).toEqual([`${src}/features/memos/fe/contract.ts:1: #features/calendar/be/types.ts`]);
  });

  it('flags a generated module that is not a leaf itself', () => {
    pack({
      'features/memos/fe/contract.ts': "import type { P } from '#generated/fe.ts';",
      'features/memos/be/contract.ts': "import { untypedBroadcastToSurface } from '#generated/events.ts';",
    });
    expect(findContractLeafImports([src], root).sort()).toEqual([
      `${src}/features/memos/be/contract.ts:1: #generated/events.ts`,
      `${src}/features/memos/fe/contract.ts:1: #generated/fe.ts`,
    ]);
  });

  /**
   * The rule that matters, and the one a check of the leaf's own imports would miss: the cycle returns just as
   * surely through two hops. This is the shape that was live in default-setup's code feature — its contract
   * imported its child modules, and those import `#generated/events` for `untypedBroadcastToSurface`.
   */
  it('flags #generated/events reached through the closure, naming the leaf it came from', () => {
    pack({
      'features/memos/be/contract.ts': "import type { Ev } from './children/list';",
      'features/memos/be/children/list.ts': "import { untypedBroadcastToSurface } from '#generated/events.ts';",
      'features/memos/fe/contract.ts': 'export type Contract = { state: {} };',
    });
    expect(findContractLeafImports([src], root)).toEqual([
      `${src}/features/memos/be/children/list.ts:1: #generated/events.ts (reached from ${src}/features/memos/be/contract.ts)`,
    ]);
  });

  /**
   * Deeper in the closure only the five generated modules a contract is behind matter: a module the leaf reaches may
   * use the rest of the generated code. `repository` is the case that fixes which way round it is — it *does* reach a
   * contract, through a feature's repository index, as twelve of default-setup's sixteen generated modules do, and is
   * allowed anyway, because what the rule is about is the three codegen generates *from* a contract and the two that
   * import the machines.
   */
  it('allows a generated module no contract is behind deeper in the closure', () => {
    pack({
      'features/memos/be/contract.ts': "import type { Ev } from './children/list';",
      'features/memos/be/children/list.ts': "import { repository } from '#generated/repository.ts';",
      'features/memos/fe/contract.ts': 'export type Contract = { state: {} };',
    });
    expect(findContractLeafImports([src], root)).toEqual([]);
  });

  /**
   * The other three, which the closure branch listed `events` and `fe` alone against until this case. `system-specs`
   * is the module in the middle of the cycle the origin commit documents — `events` reads each system's contract
   * through it — and the two pack entries import the machines, which is the cost half of the rule. Nothing in either
   * pack imports any of the three from source today: the case is here so the list matches the property stated on
   * `GENERATED_BEHIND_A_CONTRACT`, not because something reaches them now.
   */
  it('flags the other generated modules a contract is behind, reached through the closure', () => {
    pack({
      'features/memos/be/contract.ts': "import type { A } from './children/one';\nimport type { B } from './children/two';",
      'features/memos/be/children/one.ts': "import type { A } from '#generated/system-specs.ts';",
      'features/memos/be/children/two.ts': "import type { B } from '#generated/pack-entry.ts';\nimport type { C } from '#generated/pack-entry-fe.ts';",
      'features/memos/fe/contract.ts': 'export type Contract = { state: {} };',
    });
    const from = `(reached from ${src}/features/memos/be/contract.ts)`;
    expect(findContractLeafImports([src], root).sort()).toEqual([
      `${src}/features/memos/be/children/one.ts:1: #generated/system-specs.ts ${from}`,
      `${src}/features/memos/be/children/two.ts:1: #generated/pack-entry.ts ${from}`,
      `${src}/features/memos/be/children/two.ts:2: #generated/pack-entry-fe.ts ${from}`,
    ]);
  });

  /**
   * A hop that is itself a `#features/` import, which is what the walk could not follow until `mappedPathFor`
   * resolved the pack's map: two of `default-setup`'s contract closures ended at one, one of them
   * `threads/be/types.ts` reaching into `code/`, so nothing past that hop was checked at all.
   */
  it('follows a #features/ hop to #generated/events deeper in the closure', () => {
    pack({
      'features/memos/be/contract.ts': "import type { Ev } from './types.ts';",
      'features/memos/be/types.ts': "import type { H } from '#features/calendar/be/helper.ts';\nexport type Ev = H;",
      'features/calendar/be/helper.ts': "import { untypedBroadcastToSurface } from '#generated/events.ts';\nexport type H = typeof untypedBroadcastToSurface;",
      'features/memos/fe/contract.ts': 'export type Contract = { state: {} };',
    });
    expect(findContractLeafImports([src], root)).toEqual([
      `${src}/features/calendar/be/helper.ts:1: #generated/events.ts (reached from ${src}/features/memos/be/contract.ts)`,
    ]);
  });

  /**
   * The two shapes a text match cannot tell from an import, both of which this rule reported until it read the
   * reader's specifiers: `from '…'` inside a comment, and the same inside a template literal. `./state.ts` is
   * written in each case, so the regex had a resolvable target and the finding looked real.
   */
  it('ignores a machine import that is commented out', () => {
    pack({
      'features/memos/fe/contract.ts': "// import type { Ctx } from './state.ts';\nexport type Contract = { state: {} };",
      'features/memos/fe/state.ts': 'export type Ctx = { ready: boolean };',
      'features/memos/be/contract.ts': 'export type Contract = { outgoing: { type: "A" } };',
    });
    expect(findContractLeafImports([src], root)).toEqual([]);
  });

  it('ignores one written inside a template literal', () => {
    pack({
      'features/memos/fe/contract.ts': "export const SNIPPET = `import type { Ctx } from './state.ts'`;\nexport type Contract = { state: {} };",
      'features/memos/fe/state.ts': 'export type Ctx = { ready: boolean };',
      'features/memos/be/contract.ts': 'export type Contract = { outgoing: { type: "A" } };',
    });
    expect(findContractLeafImports([src], root)).toEqual([]);
  });

  it('checks nothing in a tree with no manifest, there being no contract to find', () => {
    writeAt(`${src}/features/memos/fe/contract.ts`, "import type { Ctx } from './state';");
    expect(findContractLeafImports([src], root)).toEqual([]);
  });
});

describe('findCrossFeatureImports', () => {
  const src = 'pack/src';
  /** The fixture pack's `package.json`: its subpath map, and the `exports` a case about publishing needs */
  const manifest = (exports?: Record<string, string>) =>
    writeAt('pack/package.json', JSON.stringify({ imports: PACK_IMPORTS, ...(exports ? { exports } : {}) }));

  /**
   * Every way a module can name another feature's frontend, as rows rather than as strings inside cases about
   * something else — which is how the barrel shape came to have no coverage at all: it was one specifier in a case
   * named after something else, and a rewrite of that specifier's spelling took the only case for the optional tail
   * in the rule's own pattern with it.
   *
   * `fe/public.ts` is a row for the opposite reason: it used to be excepted, a module per feature for exactly this
   * crossing, in packs and then for a while longer in the host. Nothing is excepted by name now.
   */
  const SHAPES: [shape: string, specifier: string, code?: string][] = [
    ['a # subpath', '#features/actions/fe/state.ts'],
    ['a relative path', '../../actions/fe/state.ts'],
    ['a barrel, with no path after fe', '../../actions/fe'],
    ['a .vue component', '../../actions/fe/canvas/list.vue'],
    ['the old fe/public module', '#features/actions/fe/public.ts'],
    ['a path a call names', '#features/actions/fe/state.ts', "vi.mock('#features/actions/fe/state.ts', () => ({}));"],
  ];

  // One importer for every row, inside its own feature's frontend, so no door applies and the finding is
  // unconditional. A relative row needs `../../`: one `..` from `features/code/fe/` lands inside `code/` itself.
  it.each(SHAPES)("flags another feature's frontend named by %s", (_shape, specifier, code) => {
    manifest();
    writeAt(`${src}/features/code/fe/panel.ts`, code ?? `import x from '${specifier}';`);
    expect(findCrossFeatureImports([src], root)).toEqual([`${src}/features/code/fe/panel.ts:1: ${specifier}`]);
  });

  // The line a pack author is shown is the file's, not the script block's
  it('reports the line inside a .vue script block', () => {
    manifest();
    writeAt(`${src}/features/code/fe/panel.vue`, "<script setup lang=\"ts\">\nimport { id } from '#features/actions/fe/state.ts'\n</script>");
    expect(findCrossFeatureImports([src], root)).toEqual([`${src}/features/code/fe/panel.vue:2: #features/actions/fe/state.ts`]);
  });

  /**
   * A claim about where the importer is rather than how it spells the import: sitting outside every feature is no
   * licence. What may name a feature's frontend is the module that assembles the package, which the cases below
   * read from its `exports`, and `extensions/` is not that.
   */
  it('flags a module that sits outside every feature', () => {
    writeAt(`${src}/extensions/viewer.ts`, "import List from '../features/memos/fe/canvas/list.vue';");
    expect(findCrossFeatureImports([src], root)).toEqual([`${src}/extensions/viewer.ts:1: ../features/memos/fe/canvas/list.vue`]);
  });

  it("allows a feature's own frontend, another's backend and shared modules, and generated code", () => {
    manifest();
    writeAt(`${src}/features/code/fe/panel.ts`, [
      "import { codeChild } from '#features/code/fe/utils/parent-communication.ts';",
      "import { useSurfaceState } from '#generated/fe.ts';",
      "import { featureSettings } from '#features/settings/feature-settings.ts';",
      "import type { ActionEntity } from '#features/actions/be/types.ts';",
    ].join('\n'));
    writeAt(`${src}/features/code/fe/features/list.ts`, "import state from '../state';");
    writeAt(`${src}/__generated__/pack-entry-fe.ts`, "import surface from '../features/memos/fe/surface.js';");
    // A feature's own modules outside fe/ may use its frontend, exporting what they make of it
    writeAt(`${src}/features/code/settings.ts`, "import { id } from './fe/state';\nconst label = `${id}!`;\nexport { label };");
    expect(findCrossFeatureImports([src], root)).toEqual([]);
  });

  /**
   * What a feature's own modules outside `fe/` may not do: pass its frontend on, in one step (`export … from`) or
   * in two (import, then export it again). The case above is the same modules using it and exporting what they
   * make of it, which is allowed — the door is the distinction, not the direction.
   */
  it('flags a feature that passes its own frontend on', () => {
    writeAt(`${src}/features/memos/index.ts`, "export { id, memosMachine } from './fe/state';\nexport * from './fe/public';");
    writeAt(`${src}/features/calendar/door.ts`, "import { threadsMachine as machine } from './fe/state';\nimport * as ui from './fe/canvas';\nexport { machine };\nexport default ui;");
    // Path order, which is the walk's (`sourceFiles` sorts), with each file's lines ascending inside it
    expect(findCrossFeatureImports([src], root)).toEqual([
      `${src}/features/calendar/door.ts:1: ./fe/state`,
      `${src}/features/calendar/door.ts:2: ./fe/canvas`,
      `${src}/features/memos/index.ts:1: ./fe/state`,
      `${src}/features/memos/index.ts:2: ./fe/public`,
    ]);
  });
  /**
   * The one module that may name its features' frontends is what the package publishes — `@apackdev/host`'s `./fe`
   * barrel, the hand-written counterpart of a pack's generated `pack-entry-fe.ts`. It is read from the package's
   * `exports`, so nothing has to be listed here, and a module that merely sits outside every feature gets no
   * licence from that: the case above about one is flagged exactly as a feature would be.
   */
  it("excepts the entry a package publishes, and nothing else outside a feature", () => {
    manifest({ './fe': './src/fe/index.ts' });
    writeAt(`${src}/fe/index.ts`, "export { memosMachine } from '../features/memos/fe/state';");
    writeAt(`${src}/fe/helpers.ts`, "export { memosMachine } from '../features/memos/fe/state';");
    expect(findCrossFeatureImports([src], root)).toEqual([`${src}/fe/helpers.ts:1: ../features/memos/fe/state`]);
  });

  /**
   * Published *and* outside every feature. A package may publish one feature's own module — `@apackdev/host`
   * publishes `./settings` from `features/settings/be/index.ts` — and a feature's barrel is not the package's
   * assembly. Excepting it by visibility alone handed that one feature a licence to read another's frontend that
   * no other feature had, silently, which is the hole this whole rule exists to close.
   */
  it('gives a published module inside a feature no licence, since it assembles nothing', () => {
    manifest({ './memos': './src/features/memos/be/index.ts' });
    writeAt(`${src}/features/memos/be/index.ts`, "export { codeMachine } from '../../code/fe/state';");
    expect(findCrossFeatureImports([src], root)).toEqual([`${src}/features/memos/be/index.ts:1: ../../code/fe/state`]);
  });

  /**
   * What a syntax tree leaves out and a regex does not. Written before the rule read one, so each of these
   * failed first: the reader is why `apack-cli/CLAUDE.md` records that "a regex literal holding an unbalanced
   * quote made a commented-out import look real and failed a build naming a comment".
   *
   * Not hypothetical. Three commented-out imports already sit in `default-setup`'s SFCs, in
   * `features/library/fe/canvas.vue` and `features/threads/fe/chat/input.vue`; they are quiet only because they
   * point inside their own feature. One pointing at another feature's `fe/` would have failed the build.
   */
  it('reads code, not comments, templates, template literals or styles', () => {
    manifest();
    writeAt(`${src}/features/code/fe/panel.ts`, "// import { id } from '#features/actions/fe/state.ts';");
    writeAt(`${src}/features/code/fe/block.ts`, "/* import { id } from '#features/actions/fe/state.ts'; */");
    writeAt(`${src}/features/code/fe/help.ts`, "export const help = `import { id } from '#features/actions/fe/state.ts'`;");
    writeAt(`${src}/features/code/fe/canvas.vue`, [
      '<template><code>import { id } from \'#features/actions/fe/state.ts\'</code></template>',
      '<style scoped>@import \'../../actions/fe/theme.css\';</style>',
    ].join('\n'));
    expect(findCrossFeatureImports([src], root)).toEqual([]);
  });

  // Fails closed: with no `exports` to read, every module gets the strict rule — the opposite of an exception
  // derived from a file being missing, which would widen the gate exactly when something had gone.
  it('excepts nothing when the package publishes nothing', () => {
    writeAt(`${src}/fe/index.ts`, "export { memosMachine } from '../features/memos/fe/state';");
    expect(findCrossFeatureImports([src], root)).toEqual([`${src}/fe/index.ts:1: ../features/memos/fe/state`]);
  });
});

describe('findRepositoryCasts', () => {
  it.each([
    ['packages/apack-sdk/src/content/format-applier.ts', "import { repository } from '@apackdev/sdk/services';\nexport const flows = repository as unknown as { flowsCommands: object };"],
    ['packages/apack-host/src/settings/index.ts', 'export const settings = (repository as unknown) as Settings;'],
    ['packages/default-setup/src/features/notes/be/system.ts', 'const notes = (services.repository as unknown as Record<string, unknown>).noteQueries;'],
    ['packages/renderer/src/view.vue', '<script setup lang="ts">\nconst r = repository as unknown as Repos;\n</script>'],
  ])('flags %s', (file, code) => {
    write(file, code);
    const line = file.endsWith('.vue') || file.includes('applier') ? 2 : 1;
    expect(findRepositoryCasts([`src/${file}`], root)).toEqual([expect.stringMatching(new RegExp(`^src/${file}:${line}: .*repository as unknown`))]);
  });

  it('allows typed repositories, other casts and mentions in comments', () => {
    write('packages/default-setup/src/features/notes/be/system.ts', [
      "import { repository } from '#generated/repository.ts';",
      '// never `repository as unknown as X`',
      'const notes = repository.noteQueries;',
      'const value = data as unknown as Record<string, unknown>;',
      'const repo = repository as Repositories;',
    ].join('\n'));
    expect(findRepositoryCasts(['src/packages/default-setup/src'], root)).toEqual([]);
  });

  it("checks every package's src/", () => {
    expect(packageSourceDirs()).toEqual(expect.arrayContaining([
      'packages/apack-ears/src', 'packages/apack-sdk/src', 'packages/apack-host/src', 'packages/apack-testing/src',
      'packages/api/src', 'packages/default-setup/src', 'packages/renderer/src',
    ]));
    writeAt('packages/new-package/src/index.ts', 'export const x = (repository as unknown as Repos).x;');
    fs.mkdirSync(path.join(root, 'packages', 'no-sources'), { recursive: true });
    expect(packageSourceDirs(root)).toEqual(['packages/new-package/src']);
    expect(findRepositoryCasts(packageSourceDirs(root), root)).toEqual(['packages/new-package/src/index.ts:1: repository as unknown as Repos']);
  });

  it('holds for the repo', () => {
    expect(findRepositoryCasts()).toEqual([]);
  });
});

/** A workspace package whose exports resolve source under the condition, and a consumer that imports it */
function workspace(): void {
  writeAt('packages/lib/package.json', JSON.stringify({
    name: '@apackdev/lib',
    exports: { '.': { [SOURCE_CONDITION]: './src/index.ts', default: './dist/index.js' } },
  }));
  writeAt('packages/lib/src/index.ts', 'export const x = 1;');
  writeAt('packages/consumer/package.json', JSON.stringify({ name: '@app/consumer' }));
  writeAt('packages/consumer/src/app.ts', "import { x } from '@apackdev/lib';\nexport const y = x;\n");
}

/** A second package with code of its own, for the configs that reach across directories */
function otherPackage(): void {
  writeAt('packages/other/package.json', JSON.stringify({ name: '@app/other' }));
  writeAt('packages/other/src/own.ts', 'export const own = 1;\n');
}

/** The problems for the temp root, with the given exceptions in place of the repo's */
function conditionProblems(exceptions = new Map<string, string>(), packExceptions = new Map<string, string>()): string[] {
  return findMissingSourceConditions(root, exceptions, packExceptions);
}

const NEEDS = (file: string, option: string) =>
  `${file}: needs ${option} with "${SOURCE_CONDITION}", or an entry in RESOLVES_DIST_BY_DESIGN saying why it resolves dist`;
const TSCONFIG_OPTION = 'compilerOptions.customConditions';
const VITE_OPTION = 'resolve.conditions (and ssr.resolve.conditions)';

describe('findCrossCheckoutResolution', () => {
  it('holds for the repo', () => {
    expect(findCrossCheckoutResolution()).toEqual([]);
  });

  it('catches a checkout that resolves a workspace package to another one', () => {
    // What a worktree nested in the repository does: its own build output is missing, so TypeScript
    // keeps walking up and resolves the package to the parent checkout's
    const outer = path.join(root, 'outer');
    const inner = path.join(outer, 'nested', 'worktree');
    for (const checkout of [outer, inner]) {
      writeAt(path.relative(root, path.join(checkout, 'package.json')), JSON.stringify({ name: 'root', workspaces: ['packages/*'] }));
      writeAt(path.relative(root, path.join(checkout, 'packages', 'api', 'package.json')), JSON.stringify({ name: '@app/api', types: 'dist/types.d.ts' }));
    }
    // Only the outer checkout is built, and the inner one links the package it hasn't built
    writeAt(path.relative(root, path.join(outer, 'packages', 'api', 'dist', 'types.d.ts')), 'export {};\n');
    fs.mkdirSync(path.join(inner, 'node_modules', '@app'), { recursive: true });
    fs.symlinkSync(path.join(inner, 'packages', 'api'), path.join(inner, 'node_modules', '@app', 'api'), 'dir');
    fs.mkdirSync(path.join(outer, 'node_modules', '@app'), { recursive: true });
    fs.symlinkSync(path.join(outer, 'packages', 'api'), path.join(outer, 'node_modules', '@app', 'api'), 'dir');

    expect(findCrossCheckoutResolution(outer)).toEqual([]);
    expect(findCrossCheckoutResolution(inner)).toEqual([
      // realpath: on macOS the temp dir is /var/… and resolves to /private/var/…
      expect.stringContaining(`@app/api resolves to ${fs.realpathSync(path.join(outer, 'packages', 'api', 'dist', 'types.d.ts'))}, outside this checkout`),
    ]);
  });
});

describe('findMissingSourceConditions', () => {
  beforeEach(workspace);

  it('lists the workspace packages whose exports resolve source under the condition', () => {
    expect(sourceConditionPackages(root)).toEqual(['@apackdev/lib']);
    // @apackdev/testing is not among them: its entries resolve its built bundle whoever loads them, so a
    // config importing it selects nothing and needs no condition
    // The API participates for TypeScript; its runtime entry still resolves the compiled server.
    expect(sourceConditionPackages()).toEqual(['@apackdev/ears', '@apackdev/sdk', '@apackdev/ui', '@app/api']);
  });

  // Every config-file name the check recognises, with the option each kind declares the condition in
  it.each([
    ['tsconfig.json', '{ "compilerOptions": { "strict": true } }', TSCONFIG_OPTION],
    ['tsconfig.build.json', '{ "extends": "./tsconfig.json" }', TSCONFIG_OPTION],
    ['tsconfig-build.json', '{ "compilerOptions": { "strict": true } }', TSCONFIG_OPTION],
    ['vite.config.ts', 'export default { build: {} };', VITE_OPTION],
    ['vite.config.prod.ts', 'export default { build: {} };\n', VITE_OPTION],
    ['vitest.config.mts', 'export default { test: {} };', VITE_OPTION],
    ['vitest.node.config.mts', 'export default { test: {} };\n', VITE_OPTION],
    ['tsup.config.ts', "export default { entry: ['src/app.ts'] };", 'conditions'],
    ['tsdown.config.ts', "export default { entry: ['src/app.ts'] };", 'conditions'],
    ['rollup.config.mjs', "export default { input: 'src/app.ts' };\n", 'conditions'],
    ['rollup-defs.config.mjs', "export default { input: 'src/app.ts' };\n", 'conditions'],
    ['esbuild.config.ts', 'export default { entry: [] };\n', 'conditions'],
    ['build.config.ts', 'export default { entries: [] };\n', 'conditions'],
  ])('flags %s, naming the option it needs', (file, content, option) => {
    writeAt(`packages/consumer/${file}`, content);
    expect(conditionProblems()).toEqual([NEEDS(`packages/consumer/${file}`, option)]);
  });

  it.each([
    ['declared directly', 'tsconfig.json', '{ "compilerOptions": { "customConditions": ["@apackdev/source"] } }'],
    ['a vite config listing it', 'vite.config.ts', "export default { resolve: { conditions: ['@apackdev/source'] } };"],
    ['a list the file declares', 'vitest.config.ts', `const conditions = ['${SOURCE_CONDITION}', 'node'];\nexport default { resolve: { conditions } };\n`],
    ['a spread of a list the file declares', 'vitest.config.ts', `const base = ['${SOURCE_CONDITION}'];\nexport default { resolve: { conditions: [...base, 'node'] } };\n`],
    ['an option set by assignment', 'vitest.config.ts', `export default { esbuildOptions(o) { o.conditions = ['${SOURCE_CONDITION}', 'module']; } };\n`],
  ])('accepts a config declaring the condition with %s', (_form, file, content) => {
    writeAt(`packages/consumer/${file}`, content);
    expect(conditionProblems()).toEqual([]);
  });

  it('follows an extends chain and a config merged from another one', () => {
    writeAt('packages/consumer/tsconfig.json', '{ "compilerOptions": { "customConditions": ["@apackdev/source"] } }');
    // A comment and a trailing comma: tsconfigs are JSONC
    writeAt('packages/consumer/tsconfig.test.json', '{\n  // built on the package tsconfig\n  "extends": "./tsconfig.json",\n}');
    writeAt('packages/consumer/vite.config.ts', "export default { resolve: { conditions: ['@apackdev/source'] } };");
    writeAt('packages/consumer/vitest.config.ts', "import viteConfig from './vite.config';\nexport default mergeConfig(viteConfig, {});");
    expect(conditionProblems()).toEqual([]);
  });

  it.each([
    ['a tsconfig extending a package base', '{ "extends": "@app/tsconfig/base.json" }'],
    ['a tsconfig extending a file named anything', '{ "extends": "./base.tsconfig.json" }'],
  ])('follows %s', (_form, content) => {
    writeAt('packages/consumer/node_modules/@app/tsconfig/package.json', JSON.stringify({ name: '@app/tsconfig' }));
    writeAt('packages/consumer/node_modules/@app/tsconfig/base.json', `{ "compilerOptions": { "customConditions": ["${SOURCE_CONDITION}"] } }`);
    writeAt('packages/consumer/base.tsconfig.json', `{ "compilerOptions": { "customConditions": ["${SOURCE_CONDITION}"] } }`);
    writeAt('packages/consumer/tsconfig.json', content);
    expect(conditionProblems()).toEqual([]);
  });

  it('takes the conditions a config sets over the ones it merged, which they replace', () => {
    writeAt('packages/consumer/vite.config.ts', `export default { resolve: { conditions: ['${SOURCE_CONDITION}'] } };\n`);
    writeAt('packages/consumer/vitest.config.ts', "import viteConfig from './vite.config';\nexport default mergeConfig(viteConfig, { resolve: { conditions: ['node'] } });\n");
    expect(conditionProblems()).toEqual([NEEDS('packages/consumer/vitest.config.ts', VITE_OPTION)]);
  });

  it.each([
    ['the condition named in another option', `export default { test: { exclude: ['${SOURCE_CONDITION}'] } };\n`],
    ['the condition named in an unrelated string', `export default { name: '${SOURCE_CONDITION} demo', test: {} };\n`],
    ['a comment before a closing token', `export default { test: {\n  // '${SOURCE_CONDITION}' would go here\n} };\n`],
    ['a comment after the last element', `export default { resolve: { conditions: [\n  'node',\n  // and '${SOURCE_CONDITION}', one day\n] } };\n`],
    ['the condition named only in a comment', `// resolve.conditions carries '${SOURCE_CONDITION}' — in a comment, so it declares nothing\nexport default { test: {} };\n`],
  ])('declares nothing with %s', (_form, content) => {
    writeAt('packages/consumer/vitest.config.ts', content);
    expect(conditionProblems()).toEqual([NEEDS('packages/consumer/vitest.config.ts', VITE_OPTION)]);
  });

  it.each([
    ['comes from outside this file', "import { conditions } from './shared-conditions';\nexport default { resolve: { conditions } };\n"],
    ['is built by', 'export default { resolve: { conditions: buildConditions() } };\n'],
  ])("says a condition list that %s can't be read", (why, content) => {
    writeAt('packages/consumer/vitest.config.ts', content);
    expect(conditionProblems()).toEqual([expect.stringContaining(why)]);
  });

  it('ignores a config whose tree imports no source-condition package, and a solution tsconfig', () => {
    otherPackage();
    writeAt('packages/other/src/app.ts', "import { readFile } from 'node:fs/promises';\nexport const r = readFile;\n");
    writeAt('packages/other/tsconfig.json', '{ "compilerOptions": { "strict": true } }');
    writeAt('packages/consumer/tsconfig.json', '{ "files": [], "references": [{ "path": "./tsconfig.app.json" }] }');
    writeAt('packages/consumer/tsconfig.app.json', '{ "compilerOptions": { "customConditions": ["@apackdev/source"] } }');
    expect(conditionProblems()).toEqual([]);
  });

  it('ignores the package name in a comment or a string, and skips node_modules and dist', () => {
    writeAt('packages/plain/package.json', JSON.stringify({ name: '@app/plain' }));
    writeAt('packages/plain/src/app.ts', "// import { x } from '@apackdev/lib';\nexport const hint = 'install @apackdev/lib first';\n");
    writeAt('packages/plain/node_modules/dep/index.ts', "import { x } from '@apackdev/lib';\n");
    writeAt('packages/plain/dist/index.js', "import { x } from '@apackdev/lib';\n");
    writeAt('packages/plain/tsconfig.json', '{ "compilerOptions": { "strict": true } }');
    expect(conditionProblems()).toEqual([]);
  });

  it('asks nothing of the config in a directory whose own code imports nothing', () => {
    writeAt('packages/consumer/tsconfig.json', `{ "compilerOptions": { "customConditions": ["${SOURCE_CONDITION}"] }, "include": ["src/**/*"] }`);
    writeAt('packages/consumer/tsconfig.scripts.json', '{ "compilerOptions": { "strict": true }, "include": ["scripts/**/*.ts"] }');
    writeAt('packages/consumer/scripts/run.ts', "import { readFile } from 'node:fs/promises';\nexport const r = readFile;\n");
    expect(conditionProblems()).toEqual([]);
  });

  it('compiles the include of a tsconfig that lists no files but references others', () => {
    writeAt('packages/consumer/tsconfig.json', '{ "files": [], "references": [{ "path": "./tsconfig.node.json" }], "include": ["src/**/*"] }');
    expect(conditionProblems()).toEqual([NEEDS('packages/consumer/tsconfig.json', TSCONFIG_OPTION)]);
  });

  it.each([
    ['a tsconfig whose include reaches another package', 'packages/other/tsconfig.json', '{ "include": ["../consumer/src/**/*"] }'],
    ['a bundler config whose root is another package', 'packages/other/vite.config.ts', "export default defineConfig(() => ({ root: '../consumer' }));\n"],
  ])('sees %s', (_form, file, content) => {
    otherPackage();
    writeAt(file, content);
    expect(conditionProblems()).toEqual([expect.stringContaining(`${file}: needs `)]);
  });

  it('reads the declarations a tsconfig compiles, which resolve @apackdev imports too', () => {
    otherPackage();
    writeAt('packages/other/api.d.ts', "import type { X } from '@apackdev/lib';\nexport type Y = X;\n");
    writeAt('packages/other/tsconfig.json', '{ "compilerOptions": { "strict": true } }');
    expect(conditionProblems()).toEqual([NEEDS('packages/other/tsconfig.json', TSCONFIG_OPTION)]);
  });

  it.each([
    ['a projects list', "export default { test: { projects: ['packages/consumer', 'packages/lib'] } };\n"],
    // Vitest's older field for the same thing
    ['the older workspace field', "export default { test: { workspace: ['packages/consumer', 'packages/lib'] } };\n"],
    // A list the file declares is still a list of paths
    ['a projects list the file declares', "const projects = ['packages/consumer', 'packages/lib'];\nexport default { test: { projects } };\n"],
  ])('asks nothing of a vitest config whose projects all name another config: %s', (_form, content) => {
    writeAt('vitest.config.ts', content);
    expect(conditionProblems()).toEqual([]);
  });

  it.each([
    // One project defined inline has no config of its own, so this config resolves for it
    ['a project defined inline', "export default { test: { projects: ['packages/consumer', { test: { root: 'packages/lib' } }] } };\n"],
    // A config that lists projects and also runs test files of its own compiles those files
    ['a projects list beside its own include', "export default { test: { projects: ['packages/consumer'], include: ['packages/consumer/**/*.spec.ts'] } };\n"],
    ['a projects list beside its own setupFiles', "export default { test: { projects: ['packages/consumer'], setupFiles: ['./setup.ts'] } };\n"],
    // `projects` is somebody else's option here: vite-tsconfig-paths takes one
    ['a projects option that is not the test one', "export default { define: { projects: ['packages/consumer'] }, test: { } };\n"],
    ['a surface option named projects', "export default { surfaces: [tsconfigPaths({ projects: ['./tsconfig.test.json'] })], test: {} };\n"],
  ])('flags a vitest config with %s', (_form, content) => {
    writeAt('vitest.config.ts', content);
    expect(conditionProblems()).toEqual([expect.stringContaining('vitest.config.ts: needs resolve.conditions')]);
  });

  it('says what to change when a projects list is built at run time', () => {
    writeAt('vitest.config.ts', 'export default { test: { projects: discoverProjects() } };\n');
    expect(conditionProblems()).toEqual([expect.stringContaining("its projects isn't a literal list of project paths")]);
  });

  it('sees code reachable only through a symlinked directory, and ends on a symlink to an ancestor', () => {
    writeAt('elsewhere/app.ts', "import { x } from '@apackdev/lib';\nexport const y = x;\n");
    writeAt('packages/other/package.json', JSON.stringify({ name: '@app/other' }));
    writeAt('packages/other/vite.config.ts', 'export default { build: {} };\n');
    fs.symlinkSync(path.join(root, 'elsewhere'), path.join(root, 'packages/other/src'));
    // A directory symlinked to its own ancestor: the walk records real paths, so it ends
    fs.symlinkSync(path.join(root, 'packages'), path.join(root, 'packages/other/loop'));
    const started = Date.now();
    expect(conditionProblems()).toEqual([expect.stringContaining('packages/other/vite.config.ts: needs ')]);
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  const REASON = 'API Extractor analyses .d.ts';

  it('takes an exception with its reason instead of flagging the config', () => {
    writeAt('packages/consumer/tsconfig.api-extractor.json', '{ "compilerOptions": { "strict": true } }');
    expect(conditionProblems()).toHaveLength(1);
    expect(conditionProblems(new Map([['packages/consumer/tsconfig.api-extractor.json', REASON]]))).toEqual([]);
  });

  it.each([
    ['the config declares the condition', 'tsconfig.json', 'it already declares the condition or compiles no such code'],
    ['the config is gone', 'gone.config.ts', 'the config is gone'],
  ])('reports an exception that no longer applies: %s', (_form, file, why) => {
    writeAt('packages/consumer/tsconfig.json', '{ "compilerOptions": { "customConditions": ["@apackdev/source"] } }');
    expect(conditionProblems(new Map([[`packages/consumer/${file}`, REASON]])))
      .toEqual([`packages/consumer/${file}: listed in RESOLVES_DIST_BY_DESIGN (${REASON}) but ${why}`]);
  });

  it('names the manifest that does not parse', () => {
    writeAt('packages/broken/package.json', '{ "name": ');
    expect(() => sourceConditionPackages(root)).toThrow(/packages\/broken\/package\.json: invalid JSON/);
  });

  // The other half of the rule: a pack resolves what a pack author has, which is the published dist. A
  // pack config declaring the condition compiles against a layout that exists only in this checkout.
  describe('a pack, which is any directory holding apack.json', () => {
    const MUST_NOT = (file: string, option: string) =>
      `${file}: a pack resolves the @apackdev packages' published dist, so it must not declare "${SOURCE_CONDITION}" in ${option}`
      + '; move a host-side config out of the pack tree, or add it to DECLARES_SOURCE_BY_DESIGN saying why it belongs there';

    /** A pack in the temp root, with the same importing source a host consumer has */
    function pack(dir = 'packages/my-pack'): string {
      writeAt(`${dir}/apack.json`, JSON.stringify({ id: 'my-pack', version: '0.1.0' }));
      writeAt(`${dir}/package.json`, JSON.stringify({ name: '@app/my-pack' }));
      writeAt(`${dir}/src/app.ts`, "import { x } from '@apackdev/lib';\nexport const y = x;\n");
      return dir;
    }

    it.each([
      ['a tsconfig', 'tsconfig.json', '{ "compilerOptions": { "customConditions": ["@apackdev/source"] } }', TSCONFIG_OPTION],
      ['a vitest config', 'vitest.config.ts', `export default { resolve: { conditions: ['${SOURCE_CONDITION}'] } };`, VITE_OPTION],
      ['a vite config', 'vite.config.ts', `export default { resolve: { conditions: ['${SOURCE_CONDITION}'] } };`, VITE_OPTION],
    ])('flags %s that declares the condition', (_form, file, content, option) => {
      const dir = pack();
      writeAt(`${dir}/${file}`, content);
      expect(conditionProblems()).toEqual([MUST_NOT(`${dir}/${file}`, option)]);
    });

    it('accepts a pack config that declares none, where a host config would be flagged', () => {
      const dir = pack();
      writeAt(`${dir}/tsconfig.json`, '{ "compilerOptions": { "strict": true } }');
      writeAt(`${dir}/vitest.config.ts`, 'export default { test: {} };\n');
      expect(conditionProblems()).toEqual([]);
      // The same config outside a pack is the host half of the rule
      writeAt('packages/consumer/vitest.config.ts', 'export default { test: {} };\n');
      expect(conditionProblems()).toEqual([NEEDS('packages/consumer/vitest.config.ts', VITE_OPTION)]);
    });

    it('covers a config anywhere under the pack, not just beside its manifest', () => {
      const dir = pack();
      writeAt(`${dir}/tests/vitest.config.ts`, `export default { resolve: { conditions: ['${SOURCE_CONDITION}'] } };`);
      expect(conditionProblems()).toEqual([MUST_NOT(`${dir}/tests/vitest.config.ts`, VITE_OPTION)]);
    });

    // A condition list this check cannot read is no excuse: it may or may not carry the condition
    it('flags a pack config whose condition list it cannot read', () => {
      const dir = pack();
      writeAt(`${dir}/vitest.config.ts`, 'export default { resolve: { conditions: buildConditions() } };\n');
      expect(conditionProblems()).toEqual([MUST_NOT(`${dir}/vitest.config.ts`, VITE_OPTION)]);
    });

    // The escape for a host-side config that lives in a pack's tree. It is deliberately hard to reach
    // for: the message names it, and an entry that stops applying is reported like any other.
    describe('DECLARES_SOURCE_BY_DESIGN', () => {
      const WHY = 'a Vite config the renderer builds this pack with';

      it('takes an exception with its reason instead of flagging the config', () => {
        const dir = pack();
        writeAt(`${dir}/vite.config.ts`, `export default { resolve: { conditions: ['${SOURCE_CONDITION}'] } };`);
        expect(conditionProblems()).toHaveLength(1);
        expect(conditionProblems(undefined, new Map([[`${dir}/vite.config.ts`, WHY]]))).toEqual([]);
      });

      it('excepts only the config it names, not the pack around it', () => {
        const dir = pack();
        writeAt(`${dir}/vite.config.ts`, `export default { resolve: { conditions: ['${SOURCE_CONDITION}'] } };`);
        writeAt(`${dir}/vitest.config.ts`, `export default { resolve: { conditions: ['${SOURCE_CONDITION}'] } };`);
        expect(conditionProblems(undefined, new Map([[`${dir}/vite.config.ts`, WHY]])))
          .toEqual([MUST_NOT(`${dir}/vitest.config.ts`, VITE_OPTION)]);
      });

      it.each([
        ['the config no longer declares the condition', 'export default { test: {} };\n', 'it declares no condition, so it needs no exception'],
        ['the config is gone', undefined, 'the config is gone'],
      ])('reports an exception that no longer applies: %s', (_form, content, why) => {
        const dir = pack();
        if (content !== undefined) writeAt(`${dir}/vite.config.ts`, content);
        expect(conditionProblems(undefined, new Map([[`${dir}/vite.config.ts`, WHY]])))
          .toEqual([`${dir}/vite.config.ts: listed in DECLARES_SOURCE_BY_DESIGN (${WHY}) but ${why}`]);
      });

      // Every case so far has been better served by moving the file, and the table's doc comment says so
      it('is empty in this repo', () => {
        expect([...DECLARES_SOURCE_BY_DESIGN.keys()]).toEqual([]);
      });
    });
  });

  // The repo, which is every config in it: the host's, the built-in pack's and the fixture packs'. The one
  // assertion of it, since the same call over the same tree says the same thing wherever it is written.
  it('holds for the repo', () => {
    expect(findMissingSourceConditions()).toEqual([]);
  });
});
