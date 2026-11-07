// Keeping projections in step. A write that changes what one derives from runs it in the write's own unit, so a row and
// what's derived from it commit together. Anything else, a commit from another process or one that went past the
// projection, is caught up on from what the database says changed since the projection's cursor, in chunks, so a
// backlog never holds a write up for longer than one chunk. The cursor is a row, written in the same transaction as
// what it derives, so a crash can't leave the two apart.
import type { ChangedPosition, EarsEngine, PendingChanges } from '@apackdev/ears';
import type { ProjectionDefinition } from '../framework/projections.ts';
import { SDK_ENTITIES } from '../types/sdk-entities.ts';
import { _isHostBound, boundHost } from './host-runtime.ts';
import { createLogger } from '../logger/index.ts';

const logger = createLogger('projections');

/** How many changed entities one unit applies */
const CHUNK = 500;

interface Declared { name: string; projection: ProjectionDefinition }
interface Cursor { position: ChangedPosition; version: number }

const declared = (): readonly Declared[] => (_isHostBound() ? boundHost().packs.projections() : []);
const typeOf = (id: string) => id.slice(0, id.indexOf('-'));
const cursorRow = (name: string) => `${SDK_ENTITIES.ProjectionCursor}-${name}` as never;
const versionOf = (projection: ProjectionDefinition) => projection.version ?? 1;

function readCursor(engine: EarsEngine, name: string): Cursor | undefined {
  const row = engine.query.ids(cursorRow(name)).pickOne() as Partial<Cursor> | undefined;
  return row?.position !== undefined && typeof row.version === 'number' ? { position: row.position, version: row.version } : undefined;
}

function writeCursor(engine: EarsEngine, name: string, projection: ProjectionDefinition, position: ChangedPosition): void {
  engine.upsert(SDK_ENTITIES.ProjectionCursor, { id: cursorRow(name), position, version: versionOf(projection) } as never);
}

/** Past everything this unit writes, its own derived rows included, which it stamps with the sequence it commits as */
function pastThisUnit(engine: EarsEngine): ChangedPosition {
  const sequence = engine.admin.nextSequence();
  if (sequence === undefined) throw new Error('A projection moves its cursor only inside a unit');
  return { sequence };
}

/** The ids of the types `from` names that the unit being written holds */
const pendingOf = (changes: PendingChanges | undefined, from: ReadonlySet<string>) =>
  Object.keys(changes?.entities ?? {}).filter((id) => from.has(typeOf(id)));

/**
 * In a write's unit: applies what the write changed of the projection's types, and what changed before it since the
 * cursor when that is a chunk or less. Answers whether more is left for a catch-up
 */
function inWrite(engine: EarsEngine, { name, projection }: Declared): boolean {
  const from = new Set(projection.from);
  const mine = pendingOf(engine.admin.pendingChanges(), from);
  if (mine.length === 0) return false;
  const cursor = readCursor(engine, name);
  const changed = cursor?.version === versionOf(projection) ? engine.admin.changedSince(projection.from, cursor.position, CHUNK) : undefined;
  if (!changed?.complete || !changed.done) {
    // A first run, a new version or a backlog: the write applies its own and leaves the rest to a catch-up
    projection.apply(mine);
    return true;
  }
  projection.apply([...new Set([...changed.ids, ...changed.destroyed, ...mine])]);
  writeCursor(engine, name, projection, pastThisUnit(engine));
  return false;
}

/** In a unit of its own: one chunk of catching up. Answers whether there is more */
function chunk(engine: EarsEngine, { name, projection }: Declared): boolean {
  const cursor = readCursor(engine, name);
  const changed = cursor?.version === versionOf(projection) ? engine.admin.changedSince(projection.from, cursor.position, CHUNK) : undefined;
  if (!changed?.complete) {
    // A first run, a new version, or what changed can't all be known: everything again, in this unit
    projection.rebuild();
    writeCursor(engine, name, projection, pastThisUnit(engine));
    return false;
  }
  const ids = [...changed.ids, ...changed.destroyed];
  if (ids.length === 0) return false;
  projection.apply(ids);
  writeCursor(engine, name, projection, changed.done ? pastThisUnit(engine) : changed.next);
  return !changed.done;
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
  let running: Promise<void> | undefined;
  let again = false;
  const pass = async () => {
    for (const each of declared()) {
      for (;;) {
        let more: boolean;
        try {
          more = engine.admin.transactWithoutHook(() => chunk(engine, each));
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
      for (const each of declared()) behind = inWrite(engine, each) || behind;
      // Once the write has returned: a catch-up runs units of its own, and this is the write's
      if (behind) queueMicrotask(() => void catchUp());
    },
  });
  return { catchUp };
}
