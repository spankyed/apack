import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT } from '@apackdev/host/build/packages-built';
import { repoFiles } from './_support/repo-files.ts';

/**
 * Every relative link between the repo's own documents resolves.
 *
 * The recurring cause is archiving: a goal doc in `docs/goals/` links to a finished one as
 * `../archive/goals/goal-x.md`, and the day it is archived itself that becomes
 * `docs/archive/archive/goals/goal-x.md`. Both goals archived on 2026-09-26 broke four links that way, and
 * `docs/goals/README.md` says to fix links *to* a moved file without mentioning the ones inside it. Nothing
 * noticed, because a dead link in a markdown file fails nothing.
 *
 * The docs are where this repo keeps the reasoning behind decisions — the chain's tiers, the seams, what each
 * measurement disproved — and a doc reached by following a link from another is how any of that is found. A
 * link that 404s costs the reader the chain of reasoning, silently.
 */

/** A link inside an inline code span is sample text: `docs/goals/README.md` shows link *templates* that way */
const withoutCodeSpans = (markdown: string): string => markdown.replace(/`[^`\n]*`/g, '').replace(/```[\s\S]*?```/g, '');

/**
 * Every link target, so the filter below decides what is relative rather than the pattern.
 *
 * The first version matched only `./` and `../`, which made a sibling link — `[x](goal-x.md)`, exactly what
 * archiving a doc turns its links into — invisible to this check. A mutation caught it: breaking such a link
 * left the spec green.
 */
const LINK = /\]\(([^)\s]+?)(?:\s+"[^"]*")?\)/g;

/** A link this repo can resolve: not a URL, not an anchor, not root-absolute (which no doc here uses) */
const isRelative = (target: string): boolean =>
  !/^[a-z][a-z0-9+.-]*:/i.test(target) && !target.startsWith('#') && !target.startsWith('/');

/**
 * The markdown written for a reader of this repo — not content written into the app.
 *
 * A pack's content sources and the fixture packs' are markdown too, and their links mean something else: a
 * library document's `media/pic.png` is resolved by the media store against the written tree, not by this
 * checkout's directory layout, so three of them read as dead here and are not.
 */
const docs = (): string[] =>
  repoFiles('*.md')
    .filter((file) => file.startsWith('docs/') || !file.includes('/') || /(^|\/)(CLAUDE|README)\.md$/.test(file))
    .filter((file) => !file.includes('/fixtures/') && !file.includes('/content/'));

describe("a link between the repo's documents resolves", () => {
  const broken = (): string[] => docs().flatMap((file) => {
    const text = withoutCodeSpans(fs.readFileSync(path.join(REPO_ROOT, file), 'utf-8'));
    return [...text.matchAll(LINK)]
      .map(([, target]) => target.replace(/#.*$/, ''))
      .filter((target) => target !== '' && isRelative(target))
      .filter((target) => !fs.existsSync(path.resolve(REPO_ROOT, path.dirname(file), target)))
      .map((target) => `${file} -> ${target}`);
  });

  it('there are links to check, so this is not vacuous', () => {
    expect(docs().length).toBeGreaterThan(20);
  });

  it('leaves none of them dead', () => {
    expect(broken(), 'a document links to a path that is not there. The usual cause is a doc that moved: '
      + 'archiving one turns its own `../archive/goals/x.md` into `archive/archive/goals/x.md`, and moving '
      + 'any file leaves the links pointing at it behind').toEqual([]);
  });
});

/**
 * Every `npm run <script> -w <workspace>` a document tells you to run names a script that workspace has.
 *
 * The same failure shape as a dead link, and quieter: `npm run x -w y` **exits 0 and prints nothing** when
 * `y` has no `x`, so a reader follows the instruction, sees silence, and reads it as a pass. That is how a
 * lint was "run" against a package that defines none during this file's own review — the root lints the
 * whole tree with one `oxlint .` and only the renderer has a per-package script, which is intentional and
 * documented, but the `-w` form for any other package is a no-op wearing a green exit.
 *
 * 53 such commands are in the docs and all 53 are valid, so this is a gate over something already true. The
 * mutation case below is what makes it a gate rather than a decoration.
 */
describe('a command a document tells you to run exists', () => {
  const SCOPED = /npm (?:run )?([a-z][\w:-]*) (?:--|-)w(?:orkspace)?[= ]([@\w/.<>-]+)/g;

  /**
   * A `-w` argument a document writes as a placeholder rather than a workspace — `-w <pack>`.
   *
   * Matched by `SCOPED` on purpose and skipped here, rather than left to fall outside the pattern: a
   * placeholder that escapes the regex is indistinguishable from one the rule never thought about, and the
   * first doc to write `-w <workspace>` would be silently unchecked either way. Skipping it is the same
   * answer, said out loud.
   */
  const isPlaceholder = (workspace: string): boolean => workspace.startsWith('<') && workspace.endsWith('>');

  /**
   * Each workspace's scripts, by every spelling `-w` accepts: the package name and the path to its
   * directory. npm takes either, so a document writing `-w packages/apack-cli` is running something real
   * and keying on the name alone would have reported it as broken.
   */
  const byWorkspace = (): Map<string, Set<string>> => {
    const found = new Map<string, Set<string>>();
    for (const dir of fs.readdirSync(path.join(REPO_ROOT, 'packages'))) {
      const manifest = path.join(REPO_ROOT, 'packages', dir, 'package.json');
      if (!fs.existsSync(manifest)) continue;
      const { name, scripts } = JSON.parse(fs.readFileSync(manifest, 'utf-8')) as
        { name?: string; scripts?: Record<string, string> };
      const own = new Set(Object.keys(scripts ?? {}));
      if (name) found.set(name, own);
      found.set(`packages/${dir}`, own);
    }
    return found;
  };

  /** Every scoped command in the repo's own documents, with where it was written */
  const commands = (texts: ReadonlyMap<string, string>): { doc: string; script: string; workspace: string }[] =>
    [...texts].flatMap(([doc, text]) => [...text.matchAll(SCOPED)]
      .map(([, script, workspace]) => ({ doc, script: script!, workspace: workspace! })));

  const unrunnable = (texts: ReadonlyMap<string, string>): string[] => {
    const scripts = byWorkspace();
    return commands(texts)
      .filter(({ workspace }) => !isPlaceholder(workspace))
      .filter(({ script, workspace }) => !(scripts.get(workspace) ?? new Set()).has(script))
      .map(({ doc, script, workspace }) => `${doc}: npm run ${script} -w ${workspace}`);
  };

  const live = (): Map<string, string> => new Map(repoFiles('*.md')
    .filter((file) => !file.startsWith('docs/archive/'))
    .map((file) => [file, fs.readFileSync(path.join(REPO_ROOT, file), 'utf-8')]));

  it('finds some, so this is not looking at nothing', () => {
    expect(commands(live()).length, 'the docs scope commands to a workspace').toBeGreaterThan(20);
  });

  it('leaves none that would exit 0 having done nothing', () => {
    expect([...new Set(unrunnable(live()))], 'npm exits 0 for a script a workspace does not have, so each of '
      + 'these reads as a pass while doing nothing. Fix the command, or add the script').toEqual([]);
  });

  /**
   * The two spellings `-w` accepts, and the one a document means as a blank. Derived from the manifests
   * rather than written as literals, so neither case dates when a package is renamed.
   */
  it('takes the directory form npm accepts, and skips a placeholder', () => {
    const found = [...byWorkspace()].find(([key]) => key.startsWith('packages/'));
    expect(found, 'no workspace is keyed by its directory, so the form npm accepts is unchecked').toBeDefined();
    const [dir, own] = found!;
    const [script] = [...own];
    expect(script, 'the workspace picked for this case has no scripts').toBeDefined();

    expect(unrunnable(new Map([['d.md', `run \`npm run ${script} -w ${dir}\``]])),
      'npm takes a path as well as a name, so this one runs').toEqual([]);
    expect(unrunnable(new Map([['d.md', `run \`npm run ${script} -w <pack>\``]])),
      'a placeholder is a blank, not a workspace').toEqual([]);
    expect(unrunnable(new Map([['d.md', `run \`npm run no-such-script -w ${dir}\``]])),
      'the directory form is still checked, not merely accepted').toHaveLength(1);
  });

  // The population is text, so the check is proved on a copy rather than by breaking a doc
  it('would report one that does not', () => {
    expect(unrunnable(new Map([['made-up.md', 'run `npm run no-such-script -w @apackdev/sdk` first']])))
      .toEqual(['made-up.md: npm run no-such-script -w @apackdev/sdk']);
  });
});
