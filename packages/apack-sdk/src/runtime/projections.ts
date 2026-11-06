// Keeping projections in step. A write that changes what one derives from runs it in the write's own unit, so a row and
// what's derived from it commit together. Anything else, a commit from another process or one that went past the
// projection, is caught up on from what the database says changed since the projection's cursor, in chunks, so a
// backlog never holds a write up for longer than one chunk. The cursor is a checkpoint the database keeps, written in
// the same unit as what it derives, so a crash can't leave the two apart.
import type { ChangedEntities, ChangedPosition, EarsEngine, PendingChanges } from '@apackdev/ears';
import type { ProjectionDefinition } from '../framework/projections.ts';
import { _isHostBound, boundHost } from './host-runtime.ts';
import { createLogger } from '../logger/index.ts';

const logger = createLogger('projections');

/** How many changed entities one unit applies */
const CHUNK = 500;

interface Declared { name: string; projection: ProjectionDefinition }
/**
 * The sequences of a projection's own catch-up units since its cursor last reached the end. A projection may write the
 * types it derives from (notes write a note's link targets), which moves what it applied later in the change order, so a
 * page read after its own units would meet those entities again, and a projection rewriting what it derives would never
 * reach the end. What its own unit changed last it has derived already, so it skips those; another projection doesn't
 */
type OwnUnits = Set<number>;
/**
 * Where a projection has read to. During a full pass, `pass` is the sequence the pass began from: the pass walks every
 * entity of its types in change order from the start, and once through, the cursor goes back to that sequence, so what
 * changed while the pass ran, destroys included, is applied as any backlog is
 */
interface Cursor { position: ChangedPosition; version: number; pass?: number }

const declared = (): readonly Declared[] => (_isHostBound() ? boundHost().packs.projections() : []);
const typeOf = (id: string) => id.slice(0, id.indexOf('-'));
const checkpointOf = (name: string) => `projection:${name}`;
const versionOf = (projection: ProjectionDefinition) => projection.version ?? 1;
const START: ChangedPosition = { sequence: 0 };

/** The ids of what changed, without those whose last change was the projection's own unit */
const notOwn = (changed: ChangedEntities, own: OwnUnits) => changed.ids.filter((_, index) => !own.has(changed.sequences[index]!));

function readCursor(engine: EarsEngine, name: string): Cursor | undefined {
  const held = engine.admin.checkpoint(checkpointOf(name)) as Partial<Cursor> | undefined;
  if (held?.position === undefined || typeof held.version !== 'number') return undefined;
  return { position: held.position, version: held.version, ...(typeof held.pass === 'number' && { pass: held.pass }) };
}

function writeCursor(engine: EarsEngine, name: string, projection: ProjectionDefinition, position: ChangedPosition, pass?: number): void {
  engine.admin.setCheckpoint(checkpointOf(name), { position, version: versionOf(projection), ...(pass !== undefined && { pass }) } satisfies Cursor);
}

/** The sequence this unit commits as: what it writes, its own derived rows included, is stamped with it */
function thisUnit(engine: EarsEngine): number {
  const sequence = engine.admin.nextSequence();
  if (sequence === undefined) throw new Error('A projection moves its cursor only inside a unit');
  return sequence;
}

/** The ids of the types `from` names that the unit being written holds */
const pendingOf = (changes: PendingChanges | undefined, from: ReadonlySet<string>) =>
  Object.keys(changes?.entities ?? {}).filter((id) => from.has(typeOf(id)));

/**
 * In a write's unit: applies what the write changed of the projection's types, and what changed before it since the
 * cursor when that is a chunk or less. Answers whether more is left for a catch-up
 */
function inWrite(engine: EarsEngine, { name, projection }: Declared, own: OwnUnits): boolean {
  const from = new Set(projection.from);
  const mine = pendingOf(engine.admin.pendingChanges(), from);
  if (mine.length === 0) return false;
  const cursor = readCursor(engine, name);
  const current = cursor?.version === versionOf(projection) && cursor.pass === undefined;
  const changed = current ? engine.admin.changedSince(projection.from, cursor.position, CHUNK) : undefined;
  if (!changed?.complete || !changed.done) {
    // A first run, a new version, a pass under way or a backlog: the write applies its own and leaves the rest to a
    // catch-up, whose pass meets these entities again later in the change order
    projection.apply(mine);
    return true;
  }
  projection.apply([...new Set([...notOwn(changed, own), ...changed.destroyed, ...mine])]);
  writeCursor(engine, name, projection, { sequence: thisUnit(engine) });
  own.clear();
  return false;
}

/**
 * In a unit of its own: one chunk of catching up. Answers whether there is more. The unit's write transaction is opened
 * first, so what it reads is what's there under the write lock: read before it, another process could commit in between,
 * and the cursor would move past that commit unread
 */
function chunk(engine: EarsEngine, { name, projection }: Declared, own: OwnUnits): boolean {
  const here = thisUnit(engine);
  const cursor = readCursor(engine, name);
  if (cursor?.version === versionOf(projection) && cursor.pass !== undefined) return passChunk(engine, { name, projection }, cursor.position, cursor.pass, own, here);
  const changed = cursor?.version === versionOf(projection) ? engine.admin.changedSince(projection.from, cursor.position, CHUNK) : undefined;
  if (!changed?.complete) {
    // A first run, a new version, or what changed can't all be known: everything again, a chunk at a time from the start
    projection.reset?.();
    own.clear();
    own.add(here);
    writeCursor(engine, name, projection, START, here);
    return true;
  }
  const ids = [...notOwn(changed, own), ...changed.destroyed];
  if (ids.length > 0) projection.apply(ids);
  if (changed.done) {
    if (ids.length === 0) return false;
    writeCursor(engine, name, projection, { sequence: here });
    own.clear();
    return false;
  }
  own.add(here);
  writeCursor(engine, name, projection, changed.next);
  return true;
}

/**
 * One chunk of a full pass: every entity of the projection's types, in change order. Whether a destroy before the pass
 * can be known doesn't matter, since everything is derived again; what changed during it is the backlog the cursor goes
 * back to once through
 */
function passChunk(
  engine: EarsEngine, { name, projection }: Declared, position: ChangedPosition, began: number, own: OwnUnits, here: number,
): boolean {
  const changed = engine.admin.changedSince(projection.from, position, CHUNK);
  const ids = notOwn(changed, own);
  if (ids.length > 0) projection.apply(ids);
  own.add(here);
  if (!changed.done) {
    writeCursor(engine, name, projection, changed.next, began);
    return true;
  }
  writeCursor(engine, name, projection, { sequence: began });
  // What changed during the pass is caught up on next, unless that can't be known either: then the next catch-up starts
  // another pass, rather than this one going round for good
  return engine.admin.changedSince(projection.from, { sequence: began }, 1).complete;
}

/** What keeps an engine's projections in step: installed once per engine, and asked to catch up when anything may be behind */
export interface ProjectionRunner {
  /**
   * Brings every projection up to what changed since its cursor, a chunk per unit, giving the event loop back between
   * chunks. One already running runs again once it finishes rather than twice at once, and this resolves then. A
   * projection that throws keeps its cursor, to try again next time, and holds up no other
   */
  catchUp(): Promise<void>;
}

/** @internal Runs the bound app's projections in the unit of every write that changes what they derive from */
export function _installProjections(engine: EarsEngine): ProjectionRunner {
  const owned = new Map<string, OwnUnits>();
  const ownOf = (name: string): OwnUnits => {
    let own = owned.get(name);
    if (!own) owned.set(name, (own = new Set()));
    return own;
  };
  let running: Promise<void> | undefined;
  let again = false;
  const pass = async () => {
    for (const each of declared()) {
      for (;;) {
        let more: boolean;
        try {
          more = engine.admin.transactWithoutHook(() => chunk(engine, each, ownOf(each.name)));
        } catch (error) {
          logger.error(`Catching up the projection ${each.name} failed, and it will try again:`, error as Error);
          break;
        }
        if (!more) break;
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }
  };
  const catchUp = (): Promise<void> => {
    if (running) {
      again = true;
      return running;
    }
    running = (async () => {
      try {
        do {
          again = false;
          await pass();
        } while (again);
      } finally {
        // Cleared as the last pass ends, in the same turn: a catch-up asked for after it starts a pass of its own
        running = undefined;
      }
    })();
    return running;
  };
  engine.admin.beforeCommit({
    wants: (type) => declared().some(({ projection }) => projection.from.includes(type)),
    run: () => {
      let behind = false;
      for (const each of declared()) behind = inWrite(engine, each, ownOf(each.name)) || behind;
      // Once the write has returned: a catch-up runs units of its own, and this is the write's
      if (behind) queueMicrotask(() => void catchUp());
    },
  });
  return { catchUp };
}
