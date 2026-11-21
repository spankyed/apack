// Parity gate for applying: does importing default-setup's content still produce the database it produced before?
// It compiles the pack's documents, notes, actions and prompts, imports them into a scratch database the test
// discards,
// and compares the rows against the snapshots in `__golden__/`.
//
// **If this failed and you are wondering what to do, read `CLAUDE.md` in this folder first.** It says what belongs
// in a golden and what must not, and why re-recording one is safe. The short version: a golden moves when what
// applying produces moves, you re-record it deliberately with
// `npm run content-parity:update -w @app/default-setup`, and you never hand-edit one.
//
// The v1/v2 scenarios content fixture sources (tests/_support/fixtures/content-parity), so only a change in applying moves their
// goldens; default-setup.json follows the pack's own sources, so content moves it too. The goldens were first
// recorded from the pipeline that preceded the generic content compiler.
//
// Notes are the one intended difference (goal-generic-content-compiler Decision 10): they now carry a
// contentHash and follow the same change-tracking rules as every other entry. Their contentHash field
// and apply counts are left out of the goldens, and so are their rows in the steps where the old
// pipeline overwrote notes: notes-change-tracking.spec.ts checks those steps by the Decision 10 rules.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { ImportMode, ApplyResult, ContentSelection } from '@apackdev/sdk/utils';
import { untypedQuery } from '@apackdev/sdk/ears';
import { dropAttribute, entityIds } from '@apackdev/sdk/testing';
import { compileContent, resetDatabase, apply, snapshot, type Snapshot } from './harness.ts';
import type { EARS } from '@apackdev/sdk';

const GOLDEN_DIR = path.join(import.meta.dirname, '__golden__');
const UPDATE = process.env.UPDATE_CONTENT_GOLDEN === '1';

/**
 * Steps where the old pipeline rewrote existing notes (every re-apply, whatever the mode or hash) and
 * the Decision 10 rules leave them alone: compared by those rules in notes-change-tracking.spec.ts.
 * Wipe re-applies leave notes out, so they aren't listed.
 */
export const NOTES_INTENDED_DIFFERENCES = new Set([
  ...['default', 'replace-on-collision', 'keep-existing'].flatMap((mode) => [`${mode}/unchanged`, `${mode}/changed`]),
  'untracked/untracked',
]);

type Step = { name: string; snapshot: Snapshot; counts: Record<string, ApplyResult> };

const compiled = new Map<string, string>();
async function compiledDir(sources: 'v1' | 'v2' | 'default-setup'): Promise<string> {
  if (!compiled.has(sources)) {
    compiled.set(sources, await compileContent(sources));
  }
  return compiled.get(sources)!;
}
afterAll(() => {
  for (const dir of compiled.values()) fs.rmSync(dir, { recursive: true, force: true });
});

/**
 * A step's record in the golden file. Notes' contentHash and counts are omitted (intended difference).
 * Action and prompt rows are large (function bodies), so they're recorded as a digest of the whole
 * normalized row plus the fields that identify them: still an exact comparison.
 */
function forGolden(step: Step, withNotes: boolean) {
  const rows = Object.fromEntries(
    Object.entries(step.snapshot.rows)
      .filter(([alias]) => withNotes || !alias.startsWith('Note:'))
      .map(([alias, row]) => {
        // Actions and prompts drop the compiled body and its hash, as notes drop theirs below: both move on any
        // edit to any source — a cosmetic one included — and on a bundler or tsc change with none, because an
        // action inlines its `_helpers/`. Two helper edits once moved 75 of these rows. What is left is what a
        // deliberate change moves: the label, description, category and the input schema.
        //
        // What the hash used to cover by accident is covered on purpose now: compiled-bodies.spec.ts asserts every
        // record has a body that parses and a hash of the compiler's shape, and the user-owned rule a missing hash
        // triggers is the applier's, tested once in @apackdev/sdk's applier.spec.ts.
        if (alias.startsWith('Action:') || alias.startsWith('Prompt:')) {
          const { actionFn, templateFn, contentHash, ...stable } = row;
          void actionFn; void templateFn; void contentHash;
          return [alias, stable];
        }
        if (!alias.startsWith('Note:')) return [alias, row];
        const { contentHash: _omitted, ...rest } = row;
        return [alias, rest];
      }),
  );
  const isNote = (text: string) => text.includes('Note:');
  return {
    rows,
    relations: withNotes ? step.snapshot.relations : step.snapshot.relations.filter((r) => !isNote(r)),
    media: step.snapshot.media,
    counts: Object.fromEntries(Object.entries(step.counts).filter(([key]) => key !== 'notes').sort(([a], [b]) => a.localeCompare(b))),
  };
}

function checkGolden(scenario: string, steps: Step[]) {
  const file = path.join(GOLDEN_DIR, `${scenario.replace(/\//g, '__')}.json`);
  const actual = Object.fromEntries(steps.map((step) => [
    step.name,
    forGolden(step, !NOTES_INTENDED_DIFFERENCES.has(`${scenario}/${step.name}`)),
  ]));
  if (UPDATE) {
    fs.mkdirSync(GOLDEN_DIR, { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(actual, null, 2)}\n`);
    return;
  }
  expect(fs.existsSync(file), `missing golden ${path.relative(process.cwd(), file)}`).toBe(true);
  const golden = JSON.parse(fs.readFileSync(file, 'utf-8')) as Record<string, ReturnType<typeof forGolden>>;
  // The message, not just the diff: a failure here is read without the file header above it, and the object
  // diff on tens of thousands of lines does not say what to do about it.
  expect(actual, `the ${scenario} golden moved. If that is the change you meant, re-record it deliberately —\n`
    + '  npm run content-parity:update -w @app/default-setup\n'
    + 'then read the git diff to confirm. See CLAUDE.md in this folder; never hand-edit a golden.').toEqual(golden);
}

async function run(
  plan: Array<{ name: string; sources: 'v1' | 'v2' | 'default-setup'; mode?: ImportMode; include?: Record<string, ContentSelection>; before?: () => void }>,
): Promise<Step[]> {
  resetDatabase();
  const steps: Step[] = [];
  for (const step of plan) {
    step.before?.();
    const counts = apply(await compiledDir(step.sources), { mode: step.mode, include: step.include });
    steps.push({ name: step.name, snapshot: snapshot(), counts });
  }
  return steps;
}

/** Drops the stored contentHash from the first row of a type, making it look user-owned */
function untrack(aliasPrefix: string) {
  return () => {
    const current = snapshot();
    const alias = Object.keys(current.rows).find((a) => a.startsWith(aliasPrefix));
    if (!alias) throw new Error(`no ${aliasPrefix} row to untrack`);
    const id = resolveId(alias);
    dropAttribute(id, 'contentHash');
  };
}

function resolveId(alias: string): EARS.EntityId {
  const { rows } = snapshot();
  const [type] = alias.split(':');
  const target = rows[alias];
  for (const id of entityIds() as EARS.EntityId[]) {
    if (!id.startsWith(`${type}-`)) continue;
    const row = (untypedQuery.ids(id).pickAll() as Array<Record<string, unknown>>)[0];
    const label = row?.name ?? row?.title ?? row?.label;
    if (label === (target.name ?? target.title ?? target.label)) return id;
  }
  throw new Error(`no row for ${alias}`);
}

const MODES: Array<ImportMode | undefined> = [undefined, 'replace-on-collision', 'keep-existing', 'wipe-and-replace'];

describe('content parity (golden snapshots)', () => {
  it.each(MODES.map((mode) => [mode ?? 'default']))('fresh, unchanged and changed re-applies in mode %s', async (label) => {
    const mode = label === 'default' ? undefined : label as ImportMode;
    // The old notes applier throws when it wipes nested notes (deleting a parent already deleted its
    // children), so wipe re-applies leave notes out here; notes-change-tracking.spec.ts covers wiping them.
    const include = mode === 'wipe-and-replace' ? { notes: new Set<string>() } : undefined;
    const steps = await run([
      { name: 'fresh', sources: 'v1', mode },
      { name: 'unchanged', sources: 'v1', mode, include },
      { name: 'changed', sources: 'v2', mode, include },
    ]);
    checkGolden(label, steps);
  });

  it('leaves rows without a stored contentHash alone (user-owned)', async () => {
    const steps = await run([
      { name: 'fresh', sources: 'v1' },
      {
        name: 'untracked',
        sources: 'v2',
        mode: 'replace-on-collision',
        before: () => {
          untrack('Document:Getting Started')();
          untrack('Action:Set Instructions')();
        },
      },
    ]);
    checkGolden('untracked', steps);
  });

  it('content only the included items', async () => {
    const steps = await run([
      {
        name: 'fresh',
        sources: 'v1',
        include: {
          documents: new Set(['Guides']),
          notes: new Set(['Projects']),
          actions: new Set(['Set Instructions']),
          prompts: new Set<string>(),
        },
      },
    ]);
    checkGolden('include', steps);
  });

  it("content default-setup's own notes, actions, prompts and commands", async () => {
    const steps = await run([{ name: 'fresh', sources: 'default-setup' }]);
    checkGolden('default-setup', steps);
  });
});
