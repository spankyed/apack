// The applied content over this pack's real compiled content: what an apply records for all of it, and what a
// second apply then decides. This is the gate that says the merge is right about 80-odd real items, which no
// table of constructed cases can (`apack-sdk/tests/content/merge.spec.ts` is that table).
//
// The subject is derived from the compiled index rather than listed here: a spec that reports nothing may have
// looked at nothing, and the index is what declares what there is to look at.
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { importCompiledContent, type AppliedItem, type ApplyRecord } from '@apackdev/sdk/utils';
import { CONTENT_INDEX_FILE } from '@apackdev/sdk/build';
import { contentEntity } from '@apackdev/sdk/content';
import { type EARS } from '@apackdev/sdk';
import { untypedQuery as query, untypedWrite } from '@apackdev/sdk/ears';
import { PACK_DIR, applyAfter } from './harness.ts';

/** This pack's compiled content, as its build wrote them */
const BUILT = path.join(PACK_DIR, 'dist', 'runtime', 'content');

interface IndexEntry { key: string; written?: boolean; count?: number }
const index = (): { entries: IndexEntry[] } => JSON.parse(fs.readFileSync(path.join(BUILT, CONTENT_INDEX_FILE), 'utf-8'));

/** The keys the build says it writes, and how many items each holds — the declaration this spec derives from */
const writtenEntries = () => index().entries.filter((entry) => entry.written);

const dirs: string[] = [];
/** The copies, made once: a spec file's tests share them, and only the database is per test */
const made = new Map<string, string>();

interface Variant {
  /** Every `contentHash` made different, so a re-apply has something to write; a string names the suffix */
  bump?: true | string;
  /** One field of the first action, given a new value */
  change?: [field: string, value: string];
  /** One content key emptied of its items, as a pack dropping that content would leave it */
  drop?: string;
}

/**
 * The built artifacts in a scratch directory, in a given variant. Copied rather than compiled: `compilePack`
 * would run esbuild once per action and once per prompt for content the build has already produced.
 */
function compiledDir(variant: Variant = {}): string {
  const memo = made.get(JSON.stringify(variant));
  if (memo) return memo;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'applied-content-'));
  made.set(JSON.stringify(variant), dir);
  dirs.push(dir);
  for (const file of fs.readdirSync(BUILT)) {
    const body = fs.readFileSync(path.join(BUILT, file), 'utf-8');
    fs.writeFileSync(path.join(dir, file), file === CONTENT_INDEX_FILE ? body : vary(file, body, variant));
  }
  return dir;
}

function vary(file: string, body: string, { bump, change, drop }: Variant): string {
  const parsed = JSON.parse(body) as { records?: Array<Record<string, unknown>> };
  if (drop && file === `${drop}.content.json`) return JSON.stringify({ records: [] });
  if (change && file === 'actions.content.json' && parsed.records?.[0]) parsed.records[0][change[0]] = change[1];
  return JSON.stringify(parsed, (key, value) =>
    bump && key === 'contentHash' && typeof value === 'string'
      ? `${value}-${bump === true ? 'bumped' : bump}`
      : value);
}

function apply(dir: string, previous?: ApplyRecord) {
  const record = applyAfter(previous);
  const counts = importCompiledContent({ compiledDir: dir, mode: 'replace-on-collision', applied: record });
  return { record, counts };
}

const attr = <T,>(id: EARS.EntityId, name: string): T | null =>
  (query.ids([id]).pickAll()[0] as Record<string, unknown> | undefined)?.[name] as T | null ?? null;

const isFlow = (item: AppliedItem) => item.entityType === 'Flow';

/** The parts whose hash differs between two runs' records of the same item */
function moved(before: Map<string, AppliedItem>, after: Map<string, AppliedItem>): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [key, item] of after) {
    const was = before.get(key);
    if (!was) continue;
    const parts = [...new Set([...Object.keys(item.parts), ...Object.keys(was.parts)])]
      .filter((path) => item.parts[path] !== was.parts[path]).sort();
    if (parts.length > 0) out[key] = parts;
  }
  return out;
}

let first: ReturnType<typeof apply>;

/**
 * **Applied per test, not once for the file**: `setupPackTests` empties the database in its own `beforeEach`,
 * so anything written in a `beforeAll` is gone before the first case runs.
 */
beforeEach(() => {
  expect(fs.existsSync(BUILT), 'the built content is missing: run npm run build:default-setup').toBe(true);
  first = apply(compiledDir());
});

afterAll(() => {
  for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
});

describe('the applied content over this pack’s real content', () => {
  it('records an item for everything the build says it writes', () => {
    const entries = writtenEntries();
    const declared = entries.reduce((total, entry) => total + (entry.count ?? 0), 0);

    expect(entries.map((entry) => entry.key).sort(), 'the pack stopped applying a key this spec covers')
      .toEqual(['actions', 'commands', 'flows', 'notes', 'prompts']);
    expect(declared, 'the index declares nothing, so every case here would pass over nothing').toBeGreaterThan(50);
    expect(first.record.written.size, 'an entry per declared item').toBe(declared);
    expect([...first.record.written].filter(([, item]) => Object.keys(item.parts).length === 0), 'an entry with no parts')
      .toEqual([]);
  });

  /**
   * **On a first apply the two accounts are the same set**, built by different code in the same run: the keys
   * the content declared and the items it wrote. They diverge the moment anything is skipped, which the
   * re-apply case below shows.
   */
  it('wrote an item for every key the content declared', () => {
    expect(new Set(first.record.written.keys())).toEqual(first.record.defined);
  });

  /**
   * **A part per field, read off the entity.** The entry names fields the item's content actually has, which
   * is a claim about the walk rather than a restatement of it: a derivation reading the wrong thing would
   * record parts for fields the entity does not hold.
   */
  it('records a part per field of every entity it wrote', () => {
    const disagree: Record<string, { parts: string[]; fields: string[] }> = {};
    let compared = 0;
    for (const [key, item] of first.record.written) {
      if (isFlow(item)) continue;
      const id = contentEntity(item.entityType, key)?.id;
      if (!id) continue;
      compared++;
      const stored = Object.keys((query.ids([id]).pickAll()[0] ?? {}) as Record<string, unknown>);
      const missing = Object.keys(item.parts).filter((part) => !stored.includes(part));
      if (missing.length > 0) disagree[key] = { parts: Object.keys(item.parts).sort(), fields: stored.sort() };
    }
    expect(compared, 'no entity was found to compare against').toBeGreaterThan(50);
    expect(disagree, 'a part names a field its entity does not hold').toEqual({});
  });

  /** And for a flow, the three shapes its parts take: its own fields, a part per node, and the wiring */
  it('records a flow’s own fields, each of its nodes, and its wiring', () => {
    const flows = [...first.record.written].filter(([, item]) => isFlow(item));
    expect(flows.length, 'no flow was recorded').toBeGreaterThan(0);

    for (const [key, item] of flows) {
      const id = contentEntity(item.entityType, key)!.id;
      const nodes = Object.keys(item.parts).filter((part) => part.startsWith('node:'));
      const live = query.ids(id).out('contains' as string, 'Node' as EARS.Entity).ids();
      expect(nodes.map((part) => part.slice('node:'.length)).sort(), `${key}'s node parts`).toEqual([...live].sort());
      expect(item.parts.fields, `${key} records its own fields`).toBeDefined();
      expect(item.parts.edges, `${key} records its wiring`).toBeDefined();
    }
  });

  /**
   * **The same content applied twice records the same parts.** Only `contentHash` differs between the two
   * runs, so every item is written again over values that did not change — and a derivation that read the
   * wrong thing, or read it unstably, would show up here as a part that moved.
   */
  it('records the same parts for the same content, applied twice', () => {
    const again = apply(compiledDir({ bump: true }), first.record);

    expect(again.record.written.size, 'the bumped hashes did not cause a rewrite').toBe(first.record.written.size);
    expect(moved(first.record.written, again.record.written), 'a part moved for content that did not').toEqual({});
    expect(again.record.offers.size, 'nothing was edited, so nobody has a decision to take').toBe(0);
  });

  /**
   * **And exactly one part moves when exactly one field's content does** — which is the whole of what the
   * parts add over a digest over the item, which can only say that something in it changed.
   */
  it('moves one part when one field of the content changes', () => {
    const again = apply(compiledDir({ bump: true, change: ['description', 'rewritten upstream'] }), first.record);

    const changes = moved(first.record.written, again.record.written);
    expect(Object.keys(changes), 'one item changed, so one item has a moved part').toHaveLength(1);
    expect(Object.values(changes)[0], 'and only the field that changed').toEqual(['description']);
  });

  /**
   * **A re-apply writes only what it changed**, so the two accounts stop being the same set — which is why
   * the entries of the items it skipped are the caller's to carry forward.
   */
  it('writes only the items a re-apply touched, and declares every key regardless', () => {
    const again = apply(compiledDir(), first.record);

    expect(again.record.defined, 'every key is declared again').toEqual(first.record.defined);
    expect(again.record.written.size, 'an unchanged apply wrote nothing').toBe(0);
  });

  /**
   * **The user's edit to one field of one item is kept, and named** — and nothing else of this pack's 80-odd
   * items is held back by it, which is the freeze the plan was written to end.
   */
  it('keeps the user’s edit to one item, names the part, and applies the rest', () => {
    const [key, item] = [...first.record.written].find(([, value]) => !isFlow(value) && 'description' in value.parts)!;
    const id = contentEntity(item.entityType, key)!.id;
    untypedWrite(id).set('description' as string, 'mine');

    const again = apply(compiledDir({ bump: true }), first.record);

    // The item is an action, whose entry declares `onUserEdit: 'offer'`, so the edit is a decision to put
    // to the user rather than their own writing — which is what makes it appear here at all
    expect(Object.fromEntries(again.record.offers), 'the edited item, and the part that differs')
      .toEqual({ [key]: { kind: 'update', parts: ['description'], contentHash: expect.any(String) } });
    expect(attr<string>(id, 'description'), 'the user’s value was overwritten').toBe('mine');
    expect(again.record.written.size, 'the rest of the pack was held back by one edit')
      .toBe(first.record.written.size - 1);
  });

  /**
   * **An upgrade from a version that recorded no parts adopts this pack's whole content, once.** This is
   * the path every existing install takes on the boot after the record arrives: nothing is known about any
   * of the 80-odd items, so each is written again and recorded, and edits are honoured from the next apply.
   */
  it('adopts every item on an apply whose record has never seen this pack', () => {
    const upgrade = apply(compiledDir({ bump: true }));

    expect(upgrade.record.written.size, 'every item was written again').toBe(first.record.written.size);
    expect(upgrade.record.offers.size, 'nothing can conflict with a record that holds nothing').toBe(0);
    expect(moved(first.record.written, upgrade.record.written), 'and the parts are the same content').toEqual({});

    // Recorded now, so the next apply sees the user's edit rather than adopting over it
    const [key, item] = [...upgrade.record.written].find(([, value]) => !isFlow(value) && 'description' in value.parts)!;
    untypedWrite(contentEntity(item.entityType, key)!.id).set('description' as string, 'mine');
    const again = apply(compiledDir({ bump: 'again' }), upgrade.record);
    expect([...again.record.offers.keys()]).toEqual([key]);
  });

  /**
   * **Content the pack drops is removed**, which is the behaviour the record makes possible at all: before
   * it, an item a pack stopped shipping stayed in the user's database for good.
   */
  it('removes an item the content no longer declares', () => {
    const dropped = writtenEntries().find((entry) => entry.key === 'prompts')!;
    expect(dropped.count ?? 0, 'the prompts entry writes nothing, so this removes nothing').toBeGreaterThan(0);

    const again = apply(compiledDir({ bump: true, drop: 'prompts' }), first.record);

    const promptKeys = [...first.record.written.keys()].filter((key) => key.includes(':prompts/'));
    expect(promptKeys.length).toBe(dropped.count);
    expect([...again.record.removed].sort(), 'every prompt the pack dropped').toEqual(promptKeys.sort());
    expect(query('Prompt' as EARS.Entity).pickAll(), 'the entities went with the content').toEqual([]);
  });
});
