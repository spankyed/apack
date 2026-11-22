import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT } from '@apackdev/host/build/packages-built';
import { population } from '@apackdev/sdk/testing';
import { repoFiles } from './_support/repo-files.ts';

/**
 * A feature's frontend half is a **surface** and its backend half a **system**. `plugin` names an
 * ProseMirror `Plugin` this app constructs inside a tiptap extension, a bundler plugin (Vite, rollup,
 * PostCSS, esbuild) or a plugin of a third-party CLI this app drives, and nothing else. A pack's editor
 * contribution was a fourth until it was named for what it is (`extensions.textEditor`). This guard keeps those vocabularies apart from
 * the concept now that they live side by side.
 *
 * Here and not in `@apackdev/host`, because its subject is every tracked file and not one package. A
 * suite's project is re-run when that project's inputs move, so a guard over the repo has to sit in a
 * suite that declares the repo (`SUITE_READS`' `repo`); in a package suite it would miss a name
 * committed anywhere else, which is how `identity-guard` passed two chain runs over a violation in
 * `@apackdev/cli`.
 *
 * **The patterns are the whole of the rule, and `KEPT` is what makes them trustworthy.** A pattern
 * written to catch `Plugin` is one character away from catching `TiptapPlugin`, which is published API
 * — so every group is asserted to match the names it retires *and* to leave every kept spelling alone.
 * Those two cases are live from the moment this lands; the scan over the tree is what waits.
 */

/** The concept's retired spellings, by group. A group's pattern is built from its own names. */
const RETIRED = {
  'concept-type': [
    'PluginDefinition', 'PluginDeclaration', 'PluginScope', 'PluginPane', 'PluginRouter',
    'PluginInbox', 'PluginInboxOf', 'PublicPluginInboxOf', 'PluginStateOf', 'PluginEvent', 'PluginEvents',
    'PluginHotkeyDefinition', 'PackPluginEntry', 'PackPluginEvents', 'PackPluginState', 'PackFeaturePlugin',
    'HostPluginEvents', 'OwnPluginEvents', 'QualifiedPluginEvents', 'TypedSendToPlugin',
    'PluginFrontendBinding', 'PluginCatalogEntry', 'ShellPluginCatalog', 'SendablePluginEvents',
    'PluginName', 'OwnPluginName', 'DependencyPluginName',
    // A list is completed by enumerating every occurrence, not by sampling greps. These four share no
    // prefix with the names above them, so nothing but reading the whole population puts them here —
    // and one of that kind, `setPluginVisible`, is published API, where a miss ships.
    'SettingsPluginEvents', 'ApplicationPluginEvents', 'DependencyPluginState', 'SendToPlugin',
  ],
  'concept-call': [
    'usePlugin', 'pluginIsRunning', 'usePluginState', 'readPluginState', 'writePluginState',
    'useUntypedPluginState', 'readUntypedPluginState', 'openPlugin', 'untypedOpenPlugin',
    'sendToPlugin', 'broadcastToPlugin', 'untypedBroadcastToPlugin', '_sendToLocalPlugin',
    'sendToPluginActor', 'notifyPluginActor', 'getRegisteredPlugins', 'getPluginEventValidationMap',
    '_pluginTargets', 'setPluginVisible', 'setPluginVisibility', 'updatePluginVisibility',
    'togglePluginVisibility',
  ],
  'concept-field': [
    'pluginId', 'pluginIds', 'pluginVisibility', 'lastActivePlugin', 'activePlugin',
    'pluginBindings', 'pluginDefaults',
  ],
  'concept-event': [
    'OPEN_PLUGIN', 'SEND_TO_PLUGIN', 'SELECT_PLUGIN', 'SELECT_PLUGIN_BY_SHELL', 'SET_PLUGIN_VISIBILITY',
    'PLUGIN_VISIBILITY_UPDATED', 'PLUGIN_ACTIVATED', 'PLUGIN_DEACTIVATED', 'PLUGIN_PICKED',
    'PLUGIN_DECLARATIONS_CHANGED', 'PACK_PLUGINS_UNLOADED', 'REQUEST_PLUGIN_DATA', 'RECEIVE_PLUGIN_DATA',
    'DELIVER_PLUGIN_EVENTS', 'SET_LAST_ACTIVE_PLUGIN', 'TRAIL_NEW_PLUGIN', 'SWITCH_PLUGIN_UP',
    'SWITCH_PLUGIN_DOWN', 'OPEN_PLUGIN_FROM_APP', 'APP_OPEN_PLUGIN_HELP', 'APP_POPOUT_PLUGIN',
    'PLUGIN_EVENT_TYPES', 'HOST_PLUGIN_EVENT_TYPES', 'APPLICATION_PLUGIN_EVENT_TYPES',
    'PACKS_PLUGIN_EVENT_TYPES', 'SETTINGS_PLUGIN_EVENT_TYPES', '__PLUGIN_ID__',
  ],
  /**
   * The editor contribution, which tiptap has no name for because it has no such concept: an entry
   * bundles tiptap Extensions, Vue popups and a predicate. The word was ours, so it goes with the rest.
   *
   * Longest first, which the `\b` would handle by backtracking anyway — it is for whoever reads the
   * list, `TiptapPlugin` sitting inside four of its neighbours.
   */
  'text-editor-concept': [
    'TiptapPluginDeclaration', 'TiptapPluginBinding', 'TiptapPluginSchema', 'tiptapPluginRegistry',
    'tiptapPlugins', 'TiptapPlugin', 'editorPlugins', 'editorPlugin', 'tiptap-plugins', 'pluginPopups',
  ],
} as const;

type Group = keyof typeof RETIRED;

/**
 * Groups the tree is not yet held to, for a rename in flight. Empty when none is.
 *
 * **The two cases above the scan still run for a parked group**, which is the point of parking rather
 * than commenting the group out: its pattern is held to matching every name it retires and to leaving
 * every kept spelling alone from the moment it lands, and only the sweep over the tree waits.
 *
 * A park closes itself — `parks nothing that has stopped needing it` fails once a parked group has no
 * violations left, so finishing a rename is what asks for the entry to come out.
 */
const PARKED: ReadonlySet<Group> = new Set<Group>([]);

const patternFor = (group: Group): RegExp => new RegExp(`(?<![.\\w])(${RETIRED[group].join('|')})\\b`);

/** The manifest key, which is not an identifier and so needs its own pattern. */
const MANIFEST_KEY = /"plugin":/;

/**
 * Codegen's binding prefix, which is a fragment rather than a word and so no `\b` reaches it.
 *
 * Scanned with `concept-event`'s excuse, that group holding the other generated spelling
 * (`__PLUGIN_ID__`, the scaffold placeholder). Its subject is the one line that emits it,
 * `surfaceBinding` in `apack-sdk/src/build/generate-entries.ts` — the generated output itself is
 * outside the population, so without the scan this pattern would guard nothing.
 */
const GENERATED_PREFIX = /__plugin_/;

/**
 * Bare `Plugin` is not in `concept-type`, and that is the pattern decision worth explaining.
 *
 * In this tree every bare `Plugin` belongs to somebody else — ProseMirror's class from `@tiptap/pm/state`,
 * Vite's and esbuild's config types — reached as `import { Plugin } from 'vite'`, where nothing precedes the
 * name to tell the two apart. A pattern over the name alone was 100% false positives across 23 sites.
 *
 * What the concept must not do is *declare* one again, which is a different and checkable thing.
 */
const DECLARES_PLUGIN = /^\s*(?:export\s+)?(?:declare\s+)?(?:interface|type|class)\s+Plugin\b/;

/**
 * One spelling from each vocabulary that keeps the word, which no pattern above may match.
 *
 * This is the case with teeth. Every entry is a name **somebody else defines** — ProseMirror's `Plugin`
 * and `PluginKey`, a bundler's, or a subcommand of another program — so a pattern that grew greedy
 * enough to reach one would alias a library's class or call a `claude` subcommand that does not exist.
 *
 * **No editor entry survives, and that is the point.** `tiptapPlugins` and its chain were ours; the
 * only editor names here now are ones ProseMirror exports and we import as written.
 *
 * **There is no stored-key entry, and that is the point of the storage work rather than an omission.**
 * A window key used to be a fourth vocabulary — hand-written, so a rename orphaned the user's data.
 * They are derived from the surface's ref now (`surfaceStorage`, `@apackdev/sdk/fe`), so no key in this
 * tree spells the word at all.
 */
const KEPT = [
  // ProseMirror's own API, constructed in a `tiptap/extensions/` file. This is the whole of what the
  // editor vocabulary keeps: an identifier says what it holds, and the type says whose class it is.
  'PluginKey', 'new PluginKey<SearchState>(\'search\')', 'new Plugin<SearchState>({ key: searchKey })',
  'addProseMirrorPlugins', 'editor.registerPlugin(plugin())', 'Plugin<SearchState>',
  'VitePlugin', 'esbuild.Plugin', "import('esbuild').Plugin", 'plugins: [vue()]', 'plugins.push(x)',
  'packExternalsPlugin', 'hostSharedModulesPlugin', 'postcssPlugins', 'pluginVue', 'pluginOxlint',
  "'@vitejs/plugin-vue'", "'eslint-plugin-vue'", "'rollup-plugin-dts'", "name: 'collect-bare-imports'",
  // `claude plugin` — the CLI's own plugin system, which the code feature wraps, and the most dangerous
  // of the four: its names reach a **subprocess argv**, where a rename typechecks and then calls a
  // subcommand that does not exist. A pass over this repo did exactly that, turning
  // `run(['plugin', 'install', …])` into `run(['surface', 'install', …])` — nothing in the compiler or
  // any spec could see it, because the string is only ever handed to another program.
  'PluginInfo', 'pluginDir', "'--plugin-dir'",
  "['plugin', 'list', '--json']", "run(['plugin', 'install', plugin, ...scopeArg(opts.scope)], opts)",
  "['plugin', 'marketplace', 'add', source, ...scopeArg(opts.scope)]", 'claude plugin',
] as const;

/**
 * The files a retired spelling may still appear in, per group — never per file, so an entry earned for
 * one group does not hide another arriving later.
 */
const ALLOWED: Record<string, { groups: readonly Group[]; why: string }> = {
  'packages/internal-repo-checks/tests/surface-vocabulary.spec.ts': {
    groups: ['concept-type', 'concept-call', 'concept-field', 'concept-event', 'text-editor-concept'],
    why: 'this guard, which has to spell the names it retires',
  },
};

/**
 * `docs/archive` is out here for the reason `trackedGuides` gives: archiving moves a file without
 * changing its text, so it was scanned while it was live. The population is one archived example
 * manifest (`goal-manifest-redesign.example.json`), which is a document's illustration rather than a
 * module anything imports — and renaming a key inside it would falsify the design it records.
 */
const trackedCodeFiles = (): string[] => repoFiles().filter((file) =>
  /\.(ts|tsx|js|mjs|cjs|vue|json|sh)$/.test(file)
  && !file.startsWith('docs/archive/')
  && !file.includes('node_modules/') && !file.includes('/dist/') && !file.includes('__generated__/')
  && !file.includes('/__golden__/'));

/**
 * The guides, held to the same identifier lists.
 *
 * **Every group above is a list of identifiers, never the bare word**, which is what makes this safe: a
 * guide says "a ProseMirror plugin" and "a Vite plugin" legitimately, and no pattern here matches either. It
 * exists because the code-only population let `SELECT_PLUGIN_BY_SHELL` sit in `@apackdev/host`'s guide
 * through five phases of a rename — the one place a reader would have gone to find the event's name.
 *
 * **`docs/archive` is out because it adds no coverage, not because its vocabulary is excused.** Archiving
 * moves a file; it does not change its text — so every archived document was scanned by this same case
 * while it was live under `docs/goals`, `docs/plans` or `docs/references`. What scanning it again would
 * find is only what cannot comply: a rename's own goal doc, whose evidence *is* an inventory of the
 * spellings it retired (`goal-plugins-to-surfaces.md` lists 28 published entries and 22 event names).
 * Policing that costs an `ALLOWED` row per rename that can never be removed, and whose staleness case can
 * never fire, because the file is finished. The archived guides were renamed to the current vocabulary
 * anyway — a reader greps the archive — but that is a readability change, not this gate's subject.
 *
 * `CHANGELOG.md` is released history, and `etc/` is generated from source that this already reads.
 */
const trackedGuides = (): string[] => repoFiles().filter((file) =>
  file.endsWith('.md') && !file.startsWith('docs/archive/') && file !== 'CHANGELOG.md'
  && !file.includes('/etc/') && !file.includes('node_modules/'));

/** Which groups a file actually holds, for the staleness case. */
function fires(file: string): Group[] {
  const text = fs.readFileSync(path.join(REPO_ROOT, file), 'utf-8');
  return (Object.keys(RETIRED) as Group[]).filter((group) => patternFor(group).test(text));
}

describe('the patterns themselves', () => {
  it('each group matches every name it retires', () => {
    for (const group of Object.keys(RETIRED) as Group[]) {
      const pattern = patternFor(group);
      for (const name of population(`${group}'s names`, RETIRED[group])) {
        expect(pattern.test(`const x = ${name};`), `${group} no longer matches ${name}`).toBe(true);
      }
    }
    expect(MANIFEST_KEY.test('"plugin": { "label": "Notes" }')).toBe(true);
    expect(GENERATED_PREFIX.test('const x = __plugin_memos;')).toBe(true);
    expect(DECLARES_PLUGIN.test('export interface Plugin {')).toBe(true);
    // The same keyword, mid-line: `import { …, type Plugin, … } from 'vite'` is Vite's, not a declaration
    expect(DECLARES_PLUGIN.test("import { type Plugin } from 'vite';"), 'an imported one is theirs').toBe(false);
  });

  it('leaves every spelling that keeps the word alone', () => {
    const groups = Object.keys(RETIRED) as Group[];
    const caught = population('kept spellings', KEPT).flatMap((sample) => groups
      .filter((group) => patternFor(group).test(sample))
      .map((group) => `${group} matches ${sample}`));
    expect(caught, "narrow the pattern; these are ProseMirror's, a bundler's, or another program's names").toEqual([]);
  });

  it('matches a name only on its own word, not inside a longer one', () => {
    expect(patternFor('concept-type').test('const x = SurfacePluginThing;')).toBe(false);
    expect(patternFor('concept-call').test('const x = mySendToPlugin;')).toBe(false);
  });
});

describe('the surface vocabulary', () => {
  /**
   * The whole tree, every run. What it cannot see is a name that reaches another program: the four
   * vocabularies in `KEPT` include a subprocess argv, where a rename typechecks and then calls a
   * subcommand that does not exist.
   */
  it('no code names the frontend actor a plugin', () => {
    const files = population('tracked code files', trackedCodeFiles(), { atLeast: 500 });
    const violations: string[] = [];
    for (const file of files) {
      const excused = ALLOWED[file]?.groups ?? [];
      const lines = fs.readFileSync(path.join(REPO_ROOT, file), 'utf-8').split('\n');
      lines.forEach((line, i) => {
        for (const group of Object.keys(RETIRED) as Group[]) {
          if (excused.includes(group) || PARKED.has(group)) continue;
          if (patternFor(group).test(line)) violations.push(`${file}:${i + 1} ${line.trim()}  ← ${group}`);
        }
        if (!excused.includes('concept-type') && DECLARES_PLUGIN.test(line)) {
          violations.push(`${file}:${i + 1} ${line.trim()}  ← a surface's type is Surface`);
        }
        if (!excused.includes('concept-event') && GENERATED_PREFIX.test(line)) {
          violations.push(`${file}:${i + 1} ${line.trim()}  ← codegen's binding prefix is __surface_`);
        }
        if (file.endsWith('apack.json') && MANIFEST_KEY.test(line)) {
          violations.push(`${file}:${i + 1} ${line.trim()}  ← the manifest key is features[].surface`);
        }
      });
    }
    expect(violations, 'a surface is not a plugin; see docs/archive/goals/goal-plugins-to-surfaces.md').toEqual([]);
  });

  /** The same identifier lists over the guides — see `trackedGuides` for why that is the safe half. */
  it('no guide names the frontend actor a plugin', () => {
    const violations: string[] = [];
    for (const file of population('tracked guides', trackedGuides(), { atLeast: 30 })) {
      const excused = ALLOWED[file]?.groups ?? [];
      fs.readFileSync(path.join(REPO_ROOT, file), 'utf-8').split('\n').forEach((line, i) => {
        for (const group of Object.keys(RETIRED) as Group[]) {
          if (excused.includes(group) || PARKED.has(group)) continue;
          if (patternFor(group).test(line)) violations.push(`${file}:${i + 1} ${line.trim()}  ← ${group}`);
        }
      });
    }
    expect(violations, 'a surface is not a plugin; see docs/archive/goals/goal-plugins-to-surfaces.md').toEqual([]);
  });

  /**
   * **A park closes itself.** While a rename is in flight its group has violations in the tree and this
   * passes; the moment the last one goes, the park is excusing nothing and this fails, naming the group
   * to unpark. So the final phase cannot be "forget to turn it on" — the guard asks for it.
   *
   * The edit that makes it fire is finishing the rename, which is the edit it is for.
   */
  it('parks nothing that has stopped needing it', () => {
    const obsolete = [...PARKED].filter((group) => !trackedCodeFiles().some((file) => {
      const excused = ALLOWED[file]?.groups ?? [];
      return !excused.includes(group)
        && patternFor(group).test(fs.readFileSync(path.join(REPO_ROOT, file), 'utf-8'));
    }));
    expect(obsolete, 'the rename is done — take these out of PARKED and let the scan hold the tree')
      .toEqual([]);
  });

  it('excuses nothing that has stopped needing it', () => {
    const stale = Object.entries(ALLOWED).flatMap(([file, { groups }]) => {
      if (!fs.existsSync(path.join(REPO_ROOT, file))) return [`${file}: gone`];
      const actual = fires(file);
      const unused = groups.filter((group) => !actual.includes(group) && !PARKED.has(group));
      return unused.length > 0 ? [`${file}: no longer holds ${unused.join(', ')}`] : [];
    });
    expect(stale, 'drop these from ALLOWED, or the group they name from their entry').toEqual([]);
  });
});
