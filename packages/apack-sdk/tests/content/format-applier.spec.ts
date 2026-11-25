// The generic writer's merge at its edges: an entity we wrote with no recorded parts, items two packs' content
// both identifies, content the pack has dropped, and an update hook that fails part way.
import { boundEars as ears, untypedWrite } from '@apackdev/sdk/ears';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { dropAttribute, resetTestData, startTestRuntime, testPacks } from '../../src/testing/index.ts';
import { childContentKey, createFormatApplier, describeContentKey, driftedFieldParts, contentKeyPrefix } from '../../src/content/format-applier.ts';
import type { ContentWriter } from '../../src/content/writers.ts';
import { _getMediaPath, applyRecord, type ApplyRecord, type ImportMode } from '../../src/utils/index.ts';
import type { ContentItem } from '../../src/content/item-types.ts';
import type { EARS } from '../../src/types/entities.ts';
import { defineEars, type UntypedSchema } from '@elmdb/ears';

type Memo = { id: EARS.EntityId; name: string; body: string; pinned?: boolean; mood?: string; contentHash?: string };
type Folder = { id: EARS.EntityId; name: string; label?: string; contentKey?: string };
/** The fixture's entities, typed by their shapes as a pack's facade types its own */
const typed = defineEars<UntypedSchema & { shapes: { Memo: Memo; Folder: Folder }; names: 'Memo' | 'Folder' }>(ears);
const memos = (name: string) => typed.query('Memo').where('name', name).pickAll();
const memo = (name: string) => memos(name)[0];
const edit = (name: string, fields: Partial<Memo>) => ears().write(memo(name).id).setMany(fields);

/** Content writers the entity's owning pack registers */
const registerHooks = (entity: string, hooks: ContentWriter<ContentItem>) => testPacks.contentWriters.set(entity, hooks as ContentWriter);

const dirs: string[] = [];
let dataDir: string;
beforeAll(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'applier-data-'));
  process.env.APACK_ENV ??= 'test';
  process.env.APACK_USER_DATA_DIR ??= dataDir;
  startTestRuntime({ entityTypes: ['Memo', 'Folder'] });
});
beforeEach(() => resetTestData());
afterEach(() => testPacks.contentWriters.clear());
afterAll(() => {
  for (const dir of [...dirs, dataDir]) fs.rmSync(dir, { recursive: true, force: true });
});

/** A pack's compiled memos entry: each record's contentHash is its version, as a changed source's would change */
function compiled(packId: string, records: Array<{ name: string; body: string; version?: string; [field: string]: unknown }>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'applier-'));
  dirs.push(dir);
  fs.writeFileSync(path.join(dir, 'content.json'), JSON.stringify({ version: 1, packId, entries: [] }));
  const contentItems: ContentItem[] = records.map(({ version = 'v1', ...fields }) => ({ entity: 'Memo', ...fields, contentHash: `${fields.name}-${version}` }));
  fs.writeFileSync(path.join(dir, 'memos.content.json'), JSON.stringify({ records: contentItems }));
  return dir;
}

const applier = createFormatApplier({ key: 'memos', entities: ['Memo', 'Folder'], identity: ['name'] });

/**
 * The same entry declaring `onUserEdit: 'offer'`: the user's edit is a decision to put to them rather than
 * their own writing. It is a second applier because the default is `theirs` and the default is what most
 * of these cases are about — what an offer adds is the record, never a different write.
 */
const offering = createFormatApplier({ key: 'memos', entities: ['Memo', 'Folder'], identity: ['name'], onUserEdit: 'offer' });

/**
 * One run. With a record it is an **apply** — the three-way merge the app's boot runs; with none it is an
 * **import**, which is the user asking for the pack's data back and reads nothing of what we wrote before.
 */
const apply = (dir: string, record?: ApplyRecord, mode: ImportMode = 'replace-on-collision') =>
  applier.apply({ compiledDir: dir, mode, ...(record && { applied: record }), log: () => {} });

/** The same run for the offering entry */
const applyOffering = (dir: string, record?: ApplyRecord, mode: ImportMode = 'replace-on-collision') =>
  offering.apply({ compiledDir: dir, mode, ...(record && { applied: record }), log: () => {} });

/**
 * The record the next apply reads, from what the last one left: its entries with what the run wrote over
 * them and what it removed taken out.
 *
 * **This mirrors `appliedContent.record`** (`@apackdev/host/app-state`), which is the real merge and is covered
 * where it lives (`apack-host/tests/packs/runtime/loader.spec.ts`). Here it is a fixture, so that a case can
 * say "and then the next apply" without an app.
 */
const after = (previous: ApplyRecord): ApplyRecord => {
  const items = new Map(previous.before);
  for (const [key, item] of previous.written) items.set(key, item);
  for (const key of previous.removed) items.delete(key);
  return applyRecord(items);
};

describe('the applied content a run records', () => {
  /** One part per field the writer wrote, and nothing for a field it didn't set */
  it('records a part per field it wrote', () => {
    const record = applyRecord();
    apply(compiled('pack-a', [{ name: 'Intro', body: 'Hello' }]), record);

    const [[key, item]] = [...record.written];
    expect([...record.defined], 'the key the content declared is the key the entry is under').toEqual([key]);
    expect(Object.keys(item.parts).sort(), 'every field but the hash of the source it came from').toEqual(['body', 'name']);
    expect(item).toMatchObject({ entityType: 'Memo', contentHash: 'Intro-v1' });
    expect(Object.values(item.parts).every((hash) => /^[0-9a-f]{16}$/.test(hash)), 'each part is a digest').toBe(true);
  });

  /**
   * **The part of the field the user changed moves, and no other.** This is what the entity's single digest
   * cannot say, and the reason for recording parts at all.
   */
  it('moves only the part of the field that changed', () => {
    const record = applyRecord();
    apply(compiled('pack-a', [{ name: 'Intro', body: 'Hello', mood: 'calm' }]), record);
    const item = [...record.written.values()][0];

    edit('Intro', { mood: 'mine' });

    expect(driftedFieldParts(item, memo('Intro').id)).toEqual(['mood']);
  });

  /** An item the apply left alone is not this run's to describe: its entry stays whatever the last run recorded */
  it('records nothing for an item it skipped', () => {
    const first = applyRecord();
    apply(compiled('pack-a', [{ name: 'Intro', body: 'Hello' }]), first);

    const second = after(first);
    apply(compiled('pack-a', [{ name: 'Intro', body: 'Hello' }]), second);

    expect([...second.written.keys()], 'an unchanged item was written again').toEqual([]);
    expect([...second.defined], 'and the key is still one the content declares').toEqual([...first.defined]);
  });

  it('records nothing for an item it skipped as user-owned', () => {
    const first = applyRecord();
    apply(compiled('pack-a', [{ name: 'Intro', body: 'Hello' }]), first);
    dropAttribute(memo('Intro').id, 'contentHash');

    const second = after(first);
    apply(compiled('pack-a', [{ name: 'Intro', body: 'Hello again', version: 'v2' }]), second);

    expect([...second.written.keys()]).toEqual([]);
  });

  /**
   * **The conflict is the thing this subsystem exists to make visible**, so the run names it and the parts
   * that differ. Until Phase 4 of `docs/plans/pack-content-apply.md` draws it, `applyPacks` logs it.
   */
  it('names an item with the user’s edit and a newer version, and the parts that differ', () => {
    const first = applyRecord();
    applyOffering(compiled('pack-a', [{ name: 'Intro', body: 'Hello', mood: 'calm' }]), first);
    edit('Intro', { mood: 'mine' });

    const second = after(first);
    const counts = applyOffering(compiled('pack-a', [{ name: 'Intro', body: 'Hello again', mood: 'calm', version: 'v2' }]), second);

    expect(counts).toEqual({ created: 0, updated: 0, skipped: 1 });
    expect(Object.fromEntries(second.offers)).toEqual({
      [[...first.defined][0]!]: { kind: 'update', parts: ['mood'], contentHash: 'Intro-v2' },
    });
    expect(memo('Intro').body, 'and nothing of the new version was written').toBe('Hello');
  });

  /**
   * **Under `theirs` the edit is the user's own writing, and nothing asks them about it.** The write is
   * identical either way — their version stays — so the only thing `onUserEdit` decides is whether a
   * decision is recorded for anyone to draw. A note never produces one.
   */
  it('records no decision for a `theirs` entry the user edited', () => {
    const first = applyRecord();
    apply(compiled('pack-a', [{ name: 'Intro', body: 'Hello', mood: 'calm' }]), first);
    edit('Intro', { mood: 'mine' });

    const second = after(first);
    const counts = apply(compiled('pack-a', [{ name: 'Intro', body: 'Hello again', mood: 'calm', version: 'v2' }]), second);

    expect(counts).toEqual({ created: 0, updated: 0, skipped: 1 });
    expect([...second.offers], 'theirs forever, and silent about it').toEqual([]);
    expect(memo('Intro').body).toBe('Hello');
  });

  /**
   * **An offer the user declined does not come back for that version.** `dismissed` holds the hash they were
   * shown, so a release that leaves this item alone is silent — and the next case is the other half, that a
   * release which does change it asks again.
   */
  it('does not offer a version the user has already declined, and offers the next one', () => {
    const first = applyRecord();
    applyOffering(compiled('pack-a', [{ name: 'Intro', body: 'Hello', mood: 'calm' }]), first);
    edit('Intro', { mood: 'mine' });
    const key = [...first.defined][0]!;

    const declined = after(first);
    declined.before.get(key)!.dismissed = 'Intro-v2';
    applyOffering(compiled('pack-a', [{ name: 'Intro', body: 'Hello again', mood: 'calm', version: 'v2' }]), declined);
    expect([...declined.offers], 'the version they declined').toEqual([]);

    const changedAgain = after(declined);
    applyOffering(compiled('pack-a', [{ name: 'Intro', body: 'Hello once more', mood: 'calm', version: 'v3' }]), changedAgain);
    expect([...changedAgain.offers.keys()], 'and the one after it').toEqual([key]);
  });

  /**
   * **A forced write puts back an entity the user threw away**, because the request is for the pack's item
   * and an item still in the trash is not one. Only `force` reaches a trashed entity at all — every other
   * path reads one as the user's deletion — and the fields a write sets are the record's, so nothing else
   * would clear the mark.
   */
  it('restores an entity the user trashed when the user asks for it back', () => {
    const first = applyRecord();
    applyOffering(compiled('pack-a', [{ name: 'Intro', body: 'Hello' }]), first);
    const id = memo('Intro').id;
    untypedWrite(id).trash();

    const counts = offering.apply({
      compiledDir: compiled('pack-a', [{ name: 'Intro', body: 'Hello again', version: 'v2' }]),
      mode: 'replace-on-collision', force: true, applied: applyRecord(), log: () => {},
    });

    expect(counts).toEqual({ created: 0, updated: 1, skipped: 0 });
    expect(ears().getRow(id)?.['trashedAt' as never], 'out of the trash').toBeFalsy();
    expect(ears().getRow(id)?.['body' as never]).toBe('Hello again');
  });

  /**
   * **`force` is the one write that overwrites the user, and it is what taking an offered version does.**
   * Every mode skips an edited item, so the flag rather than a mode is what makes "give me the pack's
   * version of this one item" expressible at all.
   */
  it('writes the pack’s version over the user’s edit when the user asked for it', () => {
    const first = applyRecord();
    applyOffering(compiled('pack-a', [{ name: 'Intro', body: 'Hello', mood: 'calm' }]), first);
    edit('Intro', { mood: 'mine' });

    const forced = applyRecord();
    const counts = offering.apply({
      compiledDir: compiled('pack-a', [{ name: 'Intro', body: 'Hello again', mood: 'calm', version: 'v2' }]),
      mode: 'replace-on-collision', force: true, applied: forced, log: () => {},
    });

    expect(counts).toEqual({ created: 0, updated: 1, skipped: 0 });
    expect(memo('Intro')).toMatchObject({ body: 'Hello again', mood: 'calm' });
    expect([...forced.offers], 'and nothing is left to decide').toEqual([]);
  });

  /**
   * **One edited field no longer freezes the item's other parts for good**, which is the whole of what the
   * record buys: the user's edit is kept, and the apply after the pack ships a version they have not touched
   * takes it.
   */
  it('takes a later version once the part the user changed is what the content now says', () => {
    const first = applyRecord();
    apply(compiled('pack-a', [{ name: 'Intro', body: 'Hello', mood: 'calm' }]), first);
    edit('Intro', { mood: 'mine' });

    const second = after(first);
    apply(compiled('pack-a', [{ name: 'Intro', body: 'Hello v2', mood: 'calm', version: 'v2' }]), second);
    // The user's value is now what the content ships, so nothing of ours is overwritten by taking it
    edit('Intro', { mood: 'calm' });

    const third = after(second);
    expect(apply(compiled('pack-a', [{ name: 'Intro', body: 'Hello v3', mood: 'calm', version: 'v3' }]), third))
      .toEqual({ created: 0, updated: 1, skipped: 0 });
    expect(memo('Intro').body).toBe('Hello v3');
  });
});

describe('a content key as something to show someone', () => {
  /**
   * **The subject is a key `childContentKey` built**, not a string written here: the two are one declaration,
   * and a change to the format that this reader did not follow shows up as a key rendered raw.
   */
  it('names the entry, the entity type and the identity of every level', () => {
    const root = `${contentKeyPrefix('default-setup')}actions`;
    const action = childContentKey(root, { entity: 'Action', label: 'CDX: Start Server' } as ContentItem, ['label']);

    expect(describeContentKey(action)).toBe('actions / Action "CDX: Start Server"');
    expect(describeContentKey(childContentKey(action, { entity: 'Note', title: 'Archive' } as ContentItem, ['title', 'parent'])))
      .toBe('actions / Action "CDX: Start Server" / Note "Archive"');
  });

  /** Its callers are diagnostics, so a segment it cannot take apart is shown rather than thrown over */
  it('shows a segment it cannot take apart, and never throws', () => {
    expect(describeContentKey('pack:notes/not-encoded')).toBe('notes / not-encoded');
    expect(describeContentKey('')).toBe('');
  });
});

describe('an entity the user deleted outright', () => {
  /**
   * **The entity is gone, so the record of what we wrote is all there is to go on.** A trashed entity still
   * carries its key and the writer finds it (`find` reads deleted entities); a destroyed one leaves nothing,
   * and without the record the writer cannot tell it from an item it has never written.
   */
  it('is not created again when the last apply wrote it', () => {
    const first = applyRecord();
    apply(compiled('pack-a', [{ name: 'Intro', body: 'Hello' }]), first);
    ears().write(memo('Intro').id).destroy();
    expect(memos('Intro'), 'a destroyed entity leaves nothing behind, which is the premise').toEqual([]);

    const counts = apply(compiled('pack-a', [{ name: 'Intro', body: 'Hello again', version: 'v2' }]), after(first));

    expect(counts).toEqual({ created: 0, updated: 0, skipped: 1 });
    expect(memos('Intro')).toEqual([]);
  });

  /** And the key stays declared whatever the outcome was, or the removal pass would read it as dropped */
  it('stays in the keys this run declares', () => {
    const first = applyRecord();
    apply(compiled('pack-a', [{ name: 'Intro', body: 'Hello' }]), first);
    ears().write(memo('Intro').id).destroy();

    const second = after(first);
    apply(compiled('pack-a', [{ name: 'Intro', body: 'Hello again', version: 'v2' }]), second);

    expect([...second.defined]).toEqual([...first.defined]);
    expect([...second.removed], 'and it is not removed: the content still declares it').toEqual([]);
  });

  /**
   * **An import carrying no record creates it**, which is what a user asking for a pack's data back is
   * (`IMPORT_PACK_CONTENT`), and what makes the first case about the record rather than about the writer
   * having stopped creating entities.
   */
  it('is created again by an import that carries no record', () => {
    apply(compiled('pack-a', [{ name: 'Intro', body: 'Hello' }]));
    ears().write(memo('Intro').id).destroy();

    expect(apply(compiled('pack-a', [{ name: 'Intro', body: 'Hello again', version: 'v2' }])))
      .toEqual({ created: 1, updated: 0, skipped: 0 });
    expect(memo('Intro').body).toBe('Hello again');
  });

  /**
   * **`wipe-and-replace` is exempt**, and by name rather than by luck: it removes the entities itself and
   * then creates every item, so every key would be one "the user deleted" if the rule applied to it.
   */
  it('is created again by wipe-and-replace, which removed the entities itself', () => {
    const first = applyRecord();
    apply(compiled('pack-a', [{ name: 'Intro', body: 'Hello' }]), first);

    const counts = apply(compiled('pack-a', [{ name: 'Intro', body: 'Hello again', version: 'v2' }]),
      after(first), 'wipe-and-replace');

    expect(counts).toMatchObject({ created: 1 });
    expect(memo('Intro').body).toBe('Hello again');
  });
});

describe('a row with no stored contentHash', () => {
  // The applier's user-owned rule (`format-applier.ts`: "skipped (untracked)"), which every entity type runs through. It is
  // what makes a row the user's for good, so it is tested here once rather than per entity type: notes have their
  // own case in default-setup, and actions and prompts had only a boolean in the content-parity golden.
  it('is left alone, and stays so however its record changes', () => {
    apply(compiled('pack-a', [{ name: 'Intro', body: 'Hello' }]));
    dropAttribute(memo('Intro').id, 'contentHash');

    expect(apply(compiled('pack-a', [{ name: 'Intro', body: 'Hello again', version: 'v2' }])))
      .toEqual({ created: 0, updated: 0, skipped: 1 });
    expect(memo('Intro').body).toBe('Hello');
  });

  it('is not given one by a later content, which would take it back from the user', () => {
    apply(compiled('pack-a', [{ name: 'Intro', body: 'Hello' }]));
    dropAttribute(memo('Intro').id, 'contentHash');

    apply(compiled('pack-a', [{ name: 'Intro', body: 'Hello again', version: 'v2' }]));
    expect(memo('Intro').contentHash).toBeUndefined();
  });
});

describe('an entity we wrote with no recorded parts', () => {
  /**
   * **It is adopted: written once and re-stamped**, which is the one branch of the merge that can overwrite
   * something the user typed. Every entity written before anything recorded *which part* we wrote is in
   * this state, so the alternative is freezing all of them for good — a user who upgrades would then never
   * get a fix again. The merge records ownership on adoption, so subsequent applies can distinguish user edits.
   */
  it('is written once, and its edits are honoured from then on', () => {
    apply(compiled('pack-a', [{ name: 'Intro', body: 'Hello' }]));
    // No entry for it: an apply whose record has never seen this item, which an upgrade is
    const upgrade = applyRecord();

    expect(apply(compiled('pack-a', [{ name: 'Intro', body: 'Hello again', version: 'v2' }]), upgrade))
      .toEqual({ created: 0, updated: 1, skipped: 0 });
    expect(memo('Intro').body).toBe('Hello again');

    // The write recorded its parts, so the next apply can see an edit and leaves it alone
    edit('Intro', { body: 'mine' });
    const next = after(upgrade);
    expect(apply(compiled('pack-a', [{ name: 'Intro', body: 'Hello a third time', version: 'v3' }]), next))
      .toEqual({ created: 0, updated: 0, skipped: 1 });
    expect(memo('Intro').body).toBe('mine');
  });

  it('keeps the fields no apply set: there is no previous field list, so nothing is cleared', () => {
    apply(compiled('pack-a', [{ name: 'Intro', body: 'Hello' }]));
    edit('Intro', { pinned: true });

    apply(compiled('pack-a', [{ name: 'Intro', body: 'Hello again', version: 'v2' }]), applyRecord());

    expect(memo('Intro')).toMatchObject({ body: 'Hello again', pinned: true });
  });

  /** An entity with no hash of ours is the user's by identity, which the adoption must not reach */
  it('is not adopted when it carries no hash of ours', () => {
    ears().create('Memo' as EARS.Entity, { name: 'Intro', body: 'theirs' });

    expect(apply(compiled('pack-a', [{ name: 'Intro', body: 'Hello' }]), applyRecord()))
      .toEqual({ created: 0, updated: 0, skipped: 1 });
    expect(memo('Intro').body).toBe('theirs');
  });
});

describe('content the pack has dropped', () => {
  /** Ours while it is still ours: the item left the content, so the entity goes with it */
  it('is removed, and its entry with it', () => {
    const first = applyRecord();
    apply(compiled('pack-a', [{ name: 'Intro', body: 'Hello' }, { name: 'Extra', body: 'Bye' }]), first);
    const extraKey = [...first.written.keys()].find((key) => key.includes('Extra'))!;

    const second = after(first);
    apply(compiled('pack-a', [{ name: 'Intro', body: 'Hello' }]), second);

    expect(memos('Extra')).toEqual([]);
    expect([...second.removed]).toEqual([extraKey]);
    expect(after(second).before.has(extraKey), 'the entry is dropped, so nothing recomputes the removal').toBe(false);
  });

  /** Theirs once they have touched it: kept, and named so the user can decide (Phase 4 draws it) */
  it('is kept and flagged when the user has edited it', () => {
    const first = applyRecord();
    apply(compiled('pack-a', [{ name: 'Intro', body: 'Hello' }, { name: 'Extra', body: 'Bye' }]), first);
    const extraKey = [...first.written.keys()].find((key) => key.includes('Extra'))!;
    edit('Extra', { body: 'mine' });

    const second = after(first);
    applyOffering(compiled('pack-a', [{ name: 'Intro', body: 'Hello' }]), second);

    expect(memo('Extra').body).toBe('mine');
    expect(Object.fromEntries(second.offers)).toEqual({ [extraKey]: { kind: 'removed', parts: ['body'] } });
    expect([...second.removed]).toEqual([]);
  });

  /** An entity the user has already trashed stays trashed: destroying it would take their undo with it */
  it('leaves an entity the user had already trashed in the trash', () => {
    const first = applyRecord();
    apply(compiled('pack-a', [{ name: 'Intro', body: 'Hello' }, { name: 'Extra', body: 'Bye' }]), first);
    const extraKey = [...first.written.keys()].find((key) => key.includes('Extra'))!;
    const extraId = memo('Extra').id;
    untypedWrite(extraId).trash();

    const second = after(first);
    apply(compiled('pack-a', [{ name: 'Intro', body: 'Hello' }]), second);

    expect(ears().query.withTrashed.ids(extraId).exists(), 'the trashed entity was destroyed').toBeTruthy();
    expect([...second.removed], 'and the entry goes, so nothing recomputes the removal').toEqual([extraKey]);
  });

  /**
   * **What a run was asked to write is a different question from what the pack declares.** An item left out
   * of a selection is one this run is not writing, not one the pack has dropped — so the keys come off the
   * compiled file rather than off the filtered set, and a per-key import cannot delete the rest of a pack's
   * content.
   */
  it('is not removed because a selection left it out', () => {
    const first = applyRecord();
    apply(compiled('pack-a', [{ name: 'Intro', body: 'Hello' }, { name: 'Extra', body: 'Bye' }]), first);

    const second = after(first);
    applier.apply({
      compiledDir: compiled('pack-a', [{ name: 'Intro', body: 'Hello' }, { name: 'Extra', body: 'Bye' }]),
      include: new Set(['Intro']),
      applied: second,
      log: () => {},
    });

    expect(memo('Extra').body, 'the unselected item was removed').toBe('Bye');
    expect([...second.removed]).toEqual([]);
  });

  /**
   * **And an item an error stopped the run on is not removed either.** A hook that throws reports the item
   * and the run moves on, so a key the walk never finished with is still a key the pack ships.
   */
  it('is not removed because a hook threw on it', () => {
    const first = applyRecord();
    apply(compiled('pack-a', [{ name: 'Intro', body: 'Hello' }]), first);
    // The walk reaches it (the keyed lookup finds the entity) and then throws part way through writing it
    registerHooks('Memo', { update: () => { throw new Error('boom'); } });

    const second = after(first);
    const counts = apply(compiled('pack-a', [{ name: 'Intro', body: 'Hello again', version: 'v2' }]), second);

    expect(counts.errors).toEqual(['Memo "Intro": boom']);
    expect(memo('Intro').body, 'the item the error was about').toBe('Hello');
    expect([...second.removed]).toEqual([]);
  });

  /** And an import carries no record, so asking for a pack's data back never removes anything */
  it('is not removed by an import, which reads no record', () => {
    apply(compiled('pack-a', [{ name: 'Intro', body: 'Hello' }, { name: 'Extra', body: 'Bye' }]));

    apply(compiled('pack-a', [{ name: 'Intro', body: 'Hello' }]));

    expect(memo('Extra').body).toBe('Bye');
  });

  /** A file that did not load said nothing, so there is no list to diff against */
  it('is not removed when the entry has no compiled file to read', () => {
    const first = applyRecord();
    apply(compiled('pack-a', [{ name: 'Intro', body: 'Hello' }]), first);

    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'applier-none-'));
    dirs.push(empty);
    fs.writeFileSync(path.join(empty, 'content.json'), JSON.stringify({ version: 1, packId: 'pack-a', entries: [] }));
    const second = after(first);
    apply(empty, second);

    expect(memo('Intro').body).toBe('Hello');
    expect([...second.removed]).toEqual([]);
  });
});

describe("two packs' records with the same entry key and identity", () => {
  it('write an entity each, and each pack updates only its own', () => {
    expect(apply(compiled('pack-a', [{ name: 'Welcome', body: 'From A' }]))).toMatchObject({ created: 1 });
    expect(apply(compiled('pack-b', [{ name: 'Welcome', body: 'From B' }]))).toMatchObject({ created: 1 });
    expect(memos('Welcome').map((row) => row.body).sort()).toEqual(['From A', 'From B']);

    expect(apply(compiled('pack-b', [{ name: 'Welcome', body: 'From B, revised', version: 'v2' }]))).toEqual({ created: 0, updated: 1, skipped: 0 });
    expect(apply(compiled('pack-a', [{ name: 'Welcome', body: 'From A' }]))).toEqual({ created: 0, updated: 0, skipped: 1 });
    expect(memos('Welcome').map((row) => row.body).sort()).toEqual(['From A', 'From B, revised']);
  });

  it('refuses compiled content that names no pack', () => {
    const dir = compiled('pack-a', [{ name: 'Welcome', body: 'From A' }]);
    fs.writeFileSync(path.join(dir, 'content.json'), JSON.stringify({ version: 1, entries: [] }));
    expect(() => apply(dir)).toThrow('packId');
  });
});

describe("a folder another pack written", () => {
  const folders = () => typed.query('Folder').where('name', 'internal').pickAll();
  const contents = (folder: Folder) => ears().query.ids(folder.id).out('contains', 'Memo' as EARS.Entity).pick(['name']).map((row) => row.name as string).sort();

  /** A pack's entry: one folder holding a memo per name, with the pack's own label on the folder */
  function tree(packId: string, memoNames: string[], entryKey = 'memos'): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'applier-tree-'));
    dirs.push(dir);
    fs.writeFileSync(path.join(dir, 'content.json'), JSON.stringify({ version: 1, packId, entries: [] }));
    const records: ContentItem[] = [{
      entity: 'Folder',
      name: 'internal',
      label: packId,
      contentHash: `internal-${packId}`,
      children: memoNames.map((name) => ({ entity: 'Memo', name, body: `from ${packId}`, contentHash: `${name}-v1` })),
    }];
    fs.writeFileSync(path.join(dir, `${entryKey}.content.json`), JSON.stringify({ records }));
    return dir;
  }

  it('is written into, not copied, when its hooks mark it a container', () => {
    registerHooks('Folder', { container: true });

    expect(apply(tree('pack-a', ['welcome.md']))).toEqual({ created: 2, updated: 0, skipped: 0 });
    // The folder is pack-a's; only pack-b's own memo is new
    expect(apply(tree('pack-b', ['theirs.md']))).toEqual({ created: 1, updated: 0, skipped: 1 });

    expect(folders()).toHaveLength(1);
    const [folder] = folders();
    expect(contents(folder)).toEqual(['theirs.md', 'welcome.md']);
    // Left as pack-a written it: not updated, not re-keyed
    expect(folder.label).toBe('pack-a');
    expect(folder.contentKey).toMatch(/^pack-a:/);
  });

  /**
   * **A container another content owns is not this pack's key to claim.** pack-b reuses pack-a's folder rather
   * than creating one, so that key stays out of pack-b's record — otherwise the folder going away with
   * pack-a would read as the user deleting pack-b's folder, and pack-b would never make its own again.
   */
  it("stays out of this pack's record, so this pack makes its own once that folder is gone", () => {
    registerHooks('Folder', { container: true });
    apply(tree('pack-a', ['welcome.md']));
    const packB = applyRecord();
    apply(tree('pack-b', ['theirs.md']), packB);
    ears().write(folders()[0].id).destroy();

    // Its memo is still there and still pack-b's, so only the folder is created
    expect(apply(tree('pack-b', ['theirs.md']), after(packB))).toMatchObject({ created: 1 });
    expect(folders()[0].label, "pack-b never made its own folder").toBe('pack-b');
  });

  it('is found again by the pack applying into it: applying it twice adds nothing', () => {
    registerHooks('Folder', { container: true });
    apply(tree('pack-a', ['welcome.md']));
    apply(tree('pack-b', ['theirs.md']));

    expect(apply(tree('pack-b', ['theirs.md']))).toEqual({ created: 0, updated: 0, skipped: 2 });
    expect(folders()).toHaveLength(1);
    expect(contents(folders()[0])).toEqual(['theirs.md', 'welcome.md']);
  });

  it("takes the other pack's new records in keep-existing mode, which skips only rows that exist", () => {
    registerHooks('Folder', { container: true });
    apply(tree('pack-a', ['welcome.md']));

    const counts = applier.apply({ compiledDir: tree('pack-b', ['theirs.md']), mode: 'keep-existing', log: () => {} });

    expect(counts).toEqual({ created: 1, updated: 0, skipped: 1 });
    expect(contents(folders()[0])).toEqual(['theirs.md', 'welcome.md']);
  });

  it("is shared by two entries of the pack that written it, like another pack's", () => {
    registerHooks('Folder', { container: true });
    const docs = createFormatApplier({ key: 'docs', entities: ['Memo', 'Folder'], identity: ['name'] });
    apply(tree('pack-a', ['welcome.md']));

    expect(docs.apply({ compiledDir: tree('pack-a', ['guide.md'], 'docs'), mode: 'replace-on-collision', log: () => {} }))
      .toEqual({ created: 1, updated: 0, skipped: 1 });

    expect(folders()).toHaveLength(1);
    expect(contents(folders()[0])).toEqual(['guide.md', 'welcome.md']);
  });

  /**
   * **A container the content dropped is not deleted while it holds entities we did not write.** Removing
   * the shared folder would take another pack's documents — or the user's — with it, and it is not ours to
   * remove. The entry stays, so the folder is reconsidered once those are gone.
   */
  it('is not removed with the content that dropped it while another pack’s entities are in it', () => {
    registerHooks('Folder', { container: true });
    const packA = applyRecord();
    apply(tree('pack-a', ['welcome.md']), packA);
    apply(tree('pack-b', ['theirs.md']));

    const emptied = fs.mkdtempSync(path.join(os.tmpdir(), 'applier-emptied-'));
    dirs.push(emptied);
    fs.writeFileSync(path.join(emptied, 'content.json'), JSON.stringify({ version: 1, packId: 'pack-a', entries: [] }));
    fs.writeFileSync(path.join(emptied, 'memos.content.json'), JSON.stringify({ records: [] }));
    const next = after(packA);
    apply(emptied, next);

    expect(folders(), "pack-a's folder was removed, and pack-b's memo with it").toHaveLength(1);
    expect(contents(folders()[0]), "pack-a's own memo goes, pack-b's stays").toEqual(['theirs.md']);
    const folderKey = [...packA.written].find(([, item]) => item.entityType === 'Folder')![0];
    expect([...next.removed], "pack-a's own memo, and not the folder it is in").toEqual(
      [...packA.written.keys()].filter((key) => key !== folderKey));
  });

  /**
   * **A key the walk did not reach is still a key the content declares.** The walk stops at an item it is
   * leaving alone — the mode says to keep what is there, or the user deleted it — and a subtree read as
   * content the pack had dropped would be removed: exactly the subtree the walk was being careful of.
   *
   * `declare` walking the compiled file is what makes that impossible rather than guarded, so this and the
   * two below fire on an edit to *it*: have it skip `record.children`, or take the filtered `records`
   * instead of `file.records`, and all three fail.
   */
  it('is not removed because the walk stopped at the item above it', () => {
    registerHooks('Folder', { container: false });
    const first = applyRecord();
    apply(tree('pack-a', ['welcome.md', 'guide.md']), first);

    const second = after(first);
    applier.apply({ compiledDir: tree('pack-a', ['welcome.md', 'guide.md']), mode: 'keep-existing', applied: second, log: () => {} });

    expect([...second.removed], 'a child under an item the mode skipped').toEqual([]);
    expect(second.defined, 'every key the content declares, whatever the walk did about it').toEqual(first.defined);
  });

  /**
   * **Removal follows the parent chain, so keeping an edited child keeps the entities above it.** Both the
   * folder and its memos leave the content, and the memo the user rewrote is theirs now — deleting the
   * folder it is in would take it with it.
   */
  it('is not removed while it holds an item the user edited', () => {
    const first = applyRecord();
    apply(tree('pack-a', ['welcome.md', 'guide.md']), first);
    const folderId = folders()[0].id;
    edit('guide.md', { body: 'mine' });

    const emptied = fs.mkdtempSync(path.join(os.tmpdir(), 'applier-chain-'));
    dirs.push(emptied);
    fs.writeFileSync(path.join(emptied, 'content.json'), JSON.stringify({ version: 1, packId: 'pack-a', entries: [] }));
    fs.writeFileSync(path.join(emptied, 'memos.content.json'), JSON.stringify({ records: [] }));
    const second = after(first);
    // The offering entry, so the one item that is kept is also named as a decision the user has to take
    applyOffering(emptied, second);

    expect(memo('guide.md').body, 'the item the user rewrote').toBe('mine');
    expect(ears().query.withTrashed.ids(folderId).exists(), 'the folder it is in went with the content').toBeTruthy();
    expect(contents(folders()[0]), "the sibling nobody touched is gone, and the edited one isn't").toEqual(['guide.md']);
    expect([...second.offers.keys()].map((key) => key.includes('guide')), 'the edited item is offered').toEqual([true]);
  });

  /** And the same for a subtree under an item the user threw away, which the walk also stops at */
  it('is not removed because the user trashed the item above it', () => {
    registerHooks('Folder', { container: false });
    const first = applyRecord();
    apply(tree('pack-a', ['welcome.md', 'guide.md']), first);
    untypedWrite(folders()[0].id).trash();

    const second = after(first);
    apply(tree('pack-a', ['welcome.md', 'guide.md']), second);

    expect([...second.removed], 'a child under an item the user trashed').toEqual([]);
    expect(second.defined).toEqual(first.defined);
  });

  /**
   * And the same where an error stopped the walk. This is the branch with the worst failure mode of the
   * three: a hook that throws for one item would otherwise take that item's whole subtree with it.
   */
  it('is not removed because an error stopped the walk above it', () => {
    const first = applyRecord();
    apply(tree('pack-a', ['welcome.md', 'guide.md']), first);
    registerHooks('Folder', { update: () => { throw new Error('disk full'); } });

    // A new contentHash on the folder, so the apply reaches the update that throws
    const dir = tree('pack-a', ['welcome.md', 'guide.md']);
    const file = path.join(dir, 'memos.content.json');
    const data = JSON.parse(fs.readFileSync(file, 'utf-8')) as { records: ContentItem[] };
    data.records[0].contentHash = 'internal-pack-a-v2';
    fs.writeFileSync(file, JSON.stringify(data));

    const second = after(first);
    expect(apply(dir, second)).toMatchObject({ errors: ['Folder "internal": disk full'] });

    expect([...second.removed], "the folder's whole subtree went with the error").toEqual([]);
    expect(second.defined).toEqual(first.defined);
  });

  it("is copied when its hooks don't, so a pack never writes into another's rows", () => {
    registerHooks('Folder', {});

    apply(tree('pack-a', ['welcome.md']));
    apply(tree('pack-b', ['theirs.md']));

    expect(folders().map((folder) => folder.label)).toEqual(['pack-a', 'pack-b']);
    expect(folders().map(contents)).toEqual([['welcome.md'], ['theirs.md']]);
  });

  it('is updated as usual by the pack that written it', () => {
    registerHooks('Folder', { container: true });
    apply(tree('pack-a', ['welcome.md']));

    const dir = tree('pack-a', ['welcome.md']);
    const file = path.join(dir, 'memos.content.json');
    const data = JSON.parse(fs.readFileSync(file, 'utf-8')) as { records: ContentItem[] };
    data.records[0].label = 'renamed';
    data.records[0].contentHash = 'internal-pack-a-v2';
    fs.writeFileSync(file, JSON.stringify(data));

    expect(apply(dir)).toMatchObject({ updated: 1 });
    expect(folders()).toHaveLength(1);
    expect(folders()[0].label).toBe('renamed');
  });
});

describe('wipe-and-replace', () => {
  const wipeImport = (dir: string) => applier.apply({ compiledDir: dir, mode: 'wipe-and-replace', log: () => {} });
  const folderNames = () => ears().query('Folder' as EARS.Entity).pick(['name']).map((row) => row.name as string).sort();

  it("removes rows of every entity type the entry content, even types its records don't hold", () => {
    ears().create('Folder' as EARS.Entity, { name: 'old folder' });
    ears().create('Memo' as EARS.Entity, { name: 'old memo', body: 'mine' });

    // Only top-level memos: no Folder record, yet the entry content folders too
    expect(wipeImport(compiled('pack-a', [{ name: 'Intro', body: 'Hello' }]))).toEqual({ created: 1, updated: 0, skipped: 0 });

    expect(folderNames()).toEqual([]);
    expect(memos('old memo')).toEqual([]);
    expect(memo('Intro')).toBeDefined();
  });

  it('wipes when the entry has no records', () => {
    ears().create('Memo' as EARS.Entity, { name: 'old memo', body: 'mine' });

    expect(wipeImport(compiled('pack-a', []))).toEqual({ created: 0, updated: 0, skipped: 0 });

    expect(memos('old memo')).toEqual([]);
  });

  it("leaves entity types the entry doesn't content", () => {
    const memosOnly = createFormatApplier({ key: 'memos', entities: ['Memo'], identity: ['name'] });
    ears().create('Folder' as EARS.Entity, { name: 'kept folder' });

    memosOnly.apply({ compiledDir: compiled('pack-a', [{ name: 'Intro', body: 'Hello' }]), mode: 'wipe-and-replace', log: () => {} });

    expect(folderNames()).toEqual(['kept folder']);
  });
});

describe('an update hook that fails part way', () => {
  it("reports the error and leaves the row updatable, not edited: the next content updates it", () => {
    let failing = true;
    registerHooks('Memo', {
      create: (record) => ears().create('Memo' as EARS.Entity, { name: record.name, body: record.body, pinned: false }).id(),
      update: (id, record) => {
        ears().write(id).setMany({ body: record.body });
        if (failing) throw new Error('disk full');
        ears().write(id).setMany({ pinned: record.pinned });
      },
    });
    const pinnedRecord = (version: string, pinned: boolean) => {
      const dir = compiled('demo', [{ name: 'Intro', body: `Hello ${version}`, version }]);
      const file = path.join(dir, 'memos.content.json');
      const data = JSON.parse(fs.readFileSync(file, 'utf-8')) as { records: ContentItem[] };
      data.records[0].pinned = pinned;
      fs.writeFileSync(file, JSON.stringify(data));
      return dir;
    };
    apply(pinnedRecord('v1', false));

    const failed = apply(pinnedRecord('v2', true));
    expect(failed).toMatchObject({ updated: 0, errors: ['Memo "Intro": disk full'] });
    expect(memo('Intro')).toMatchObject({ body: 'Hello v2', pinned: false, contentHash: 'Intro-v1' });

    failing = false;
    expect(apply(pinnedRecord('v2', true))).toEqual({ created: 0, updated: 1, skipped: 0 });
    expect(memo('Intro')).toMatchObject({ body: 'Hello v2', pinned: true, contentHash: 'Intro-v2' });
  });

  it("re-takes the item's entry over the fields it had: a field the record newly sets isn't recorded as ours", () => {
    registerHooks('Memo', {
      update: (id, record) => {
        ears().write(id).setMany({ body: record.body });
        throw new Error('disk full');
      },
    });
    const first = applyRecord();
    apply(compiled('demo', [{ name: 'Intro', body: 'Hello' }]), first);
    // The user's mood, which the next version of the record sets too
    edit('Intro', { mood: 'mine' });

    const second = after(first);
    expect(apply(compiled('demo', [{ name: 'Intro', body: 'Hello v2', mood: 'calm', version: 'v2' }]), second))
      .toMatchObject({ errors: ['Memo "Intro": disk full'] });
    expect(memo('Intro').mood).toBe('mine');
    const item = second.written.get([...first.written.keys()][0])!;
    expect(Object.keys(item.parts).sort(), 'the fields the entry named, not the ones the new record sets').toEqual(['body', 'name']);
    // Re-taken from what the entity holds now, so the next apply updates it rather than reading the
    // half-written values as the user's edit
    expect(driftedFieldParts(item, memo('Intro').id)).toEqual([]);
  });
});

describe('a field a changed record no longer sets', () => {
  it("is dropped from the entity, and a field the apply never set is kept", () => {
    const first = applyRecord();
    apply(compiled('demo', [{ name: 'Intro', body: 'Hello', pinned: true }]), first);
    const second = after(first);
    expect(apply(compiled('demo', [{ name: 'Intro', body: 'Hello', version: 'v2' }]), second)).toEqual({ created: 0, updated: 1, skipped: 0 });
    expect(memo('Intro').pinned).toBeUndefined();
    expect(Object.keys(second.written.get([...first.written.keys()][0])!.parts).sort()).toEqual(['body', 'name']);
  });

  /** Which fields those are comes from the entry, so an apply with no entry for the item clears nothing */
  it('is passed to the update hook to reset', () => {
    const cleared: string[][] = [];
    registerHooks('Memo', {
      update: (id, record, { clearedFields }) => {
        cleared.push(clearedFields);
        ears().write(id).setMany({ body: record.body, ...(clearedFields.includes('pinned') && { pinned: false }) });
      },
    });
    const first = applyRecord();
    apply(compiled('demo', [{ name: 'Intro', body: 'Hello', pinned: true }]), first);
    apply(compiled('demo', [{ name: 'Intro', body: 'Hello', version: 'v2' }]), after(first));
    expect(cleared).toEqual([['pinned']]);
    expect(memo('Intro').pinned).toBe(false);
  });
});

describe('a created row that fails before it is tracked', () => {
  it('is removed and the error reported, so the next content creates it again and tracks it', () => {
    let failing = true;
    registerHooks('Memo', {
      update: (id, record) => {
        if (failing) throw new Error('disk full');
        ears().write(id).setMany({ body: record.body });
      },
    });
    const mediaApplier = createFormatApplier({ key: 'memos', entities: ['Memo', 'Folder'], identity: ['name'], media: true });
    const dir = compiled('demo', [{ name: 'Intro', body: 'See ![pic](media/pic.png)' }]);
    fs.mkdirSync(path.join(dir, 'media', 'memos'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'media', 'memos', 'pic.png'), 'PNG');
    const contentMedia = () => mediaApplier.apply({ compiledDir: dir, mode: 'replace-on-collision', log: () => {} });

    expect(contentMedia()).toMatchObject({ created: 0, errors: ['Memo "Intro": disk full'] });
    expect(memos('Intro')).toEqual([]);

    failing = false;
    expect(contentMedia()).toEqual({ created: 1, updated: 0, skipped: 0 });
    const { id, body } = memo('Intro');
    expect(body).toBe(`See ![pic](media://${id}/pic.png)`);
    expect(fs.readdirSync(_getMediaPath())).toEqual([id]);
    expect(contentMedia()).toEqual({ created: 0, updated: 0, skipped: 1 });
  });
});

describe('media links that point outside the media folders', () => {
  it('are left as written, copying nothing in or out', () => {
    const mediaApplier = createFormatApplier({ key: 'memos', entities: ['Memo', 'Folder'], identity: ['name'], media: true });
    // `media/../memos/pic.png` reads a file inside the compiled media but would write beside the row's folder
    const dir = compiled('demo', [{ name: 'Escape', body: 'A ![up](media/../../secret.txt) B ![link](media/linked.png) C ![side](media/../memos/pic.png) D ![ok](media/pic.png)' }]);
    const mediaDir = path.join(dir, 'media', 'memos');
    fs.mkdirSync(mediaDir, { recursive: true });
    fs.writeFileSync(path.join(mediaDir, 'pic.png'), 'PNG');
    // Beside the compiled media, where `..` reaches, and a symlink out of it
    fs.writeFileSync(path.join(dir, 'secret.txt'), 'SECRET');
    fs.symlinkSync(path.join(dir, 'secret.txt'), path.join(mediaDir, 'linked.png'));

    expect(mediaApplier.apply({ compiledDir: dir, mode: 'replace-on-collision', log: () => {} })).toEqual({ created: 1, updated: 0, skipped: 0 });

    const { id, body } = memo('Escape');
    expect(body).toBe(`A ![up](media/../../secret.txt) B ![link](media/linked.png) C ![side](media/../memos/pic.png) D ![ok](media://${id}/pic.png)`);
    expect(fs.readdirSync(path.join(_getMediaPath(), id))).toEqual(['pic.png']);
    // Where the `..` links would have been written
    expect(fs.existsSync(path.join(_getMediaPath(), 'memos'))).toBe(false);
    expect(fs.existsSync(path.join(_getMediaPath(), '..', 'secret.txt'))).toBe(false);
  });
});
