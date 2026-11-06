// Keeping projections in step: in the unit of a write that changes what one derives from, and from the change log for
// commits another process made. What each has read up to is a row, written in the same transaction as what it derives,
// so a crash can't leave the two apart.
import type { EarsEngine, LoggedChanges } from '@apackdev/ears';
import type { ProjectionDefinition } from '../framework/projections.ts';
import { SDK_ENTITIES } from '../types/sdk-entities.ts';
import { _isHostBound, boundHost } from './host-runtime.ts';
import { createLogger } from '../logger/index.ts';

const logger = createLogger('projections');

/** More than the change log holds, so one read is everything since any cursor */
const WHOLE_LOG = 8192;

interface Declared { name: string; projection: ProjectionDefinition }

const declared = (): readonly Declared[] => (_isHostBound() ? boundHost().packs.projections() : []);
const typeOf = (id: string) => id.slice(0, id.indexOf('-'));
const cursorRow = (name: string) => `${SDK_ENTITIES.ProjectionCursor}-${name}` as never;

/** The ids a unit being written holds of the types `from` names */
const pendingOf = (changes: LoggedChanges, from: ReadonlySet<string>) =>
  Object.keys(changes.pending?.entities ?? {}).filter((id) => from.has(typeOf(id)));

function bringUp(engine: EarsEngine, { name, projection }: Declared, inWrite: boolean): void {
  const from = new Set(projection.from);
  // A write that changed nothing this derives from leaves it, and other processes' commits, to their own catching up,
  // and reads no more of the log than its own unit's changes
  if (inWrite && pendingOf(engine.admin.changesSince(engine.lastCommit(), 1), from).length === 0) return;
  const row = cursorRow(name);
  const cursor = (engine.query.ids(row).pickOne() as { through?: number } | undefined)?.through;
  const changes: LoggedChanges = engine.admin.changesSince(cursor ?? 0, WHOLE_LOG);
  const mine = pendingOf(changes, from);

  const own = engine.admin.origin();
  const theirs = changes.commits.filter((commit) => commit.origin !== own);
  // This process's commits went through the write hook, which ran this as they were written, but for one that didn't
  // say what it changed: an admin load, which no hook sees
  const unknowable = cursor === undefined || changes.truncated
    || changes.commits.some((commit) => commit.everything)
    || theirs.some((commit) => commit.entities === undefined && commit.types.some((type) => from.has(type)));
  if (unknowable) {
    projection.rebuild();
  } else {
    const ids = new Set([...mine, ...theirs.flatMap((commit) => (commit.entities ?? []).filter((id) => from.has(typeOf(id))))]);
    if (ids.size > 0) projection.apply([...ids]);
    else if (changes.through === cursor) return;
  }
  engine.upsert(SDK_ENTITIES.ProjectionCursor, { id: row, through: changes.through } as never);
}

/** @internal Runs the bound app's projections in the unit of every write that changes what they derive from */
export function _installProjections(engine: EarsEngine): void {
  engine.admin.beforeCommit({
    wants: (type) => declared().some(({ projection }) => projection.from.includes(type)),
    run: () => {
      for (const each of declared()) bringUp(engine, each, true);
    },
  });
}

/**
 * @internal Brings every projection up to the change log: at boot, after the data was replaced, and told of another
 * process. Each in a unit of its own, so one that throws keeps its cursor, to try again next time, and holds up no other
 */
export function _catchUpProjections(engine: EarsEngine): void {
  for (const each of declared()) {
    try {
      engine.admin.transactWithoutHook(() => bringUp(engine, each, false));
    } catch (error) {
      logger.error(`Catching up the projection ${each.name} failed, and it will try again:`, error as Error);
    }
  }
}
