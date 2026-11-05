// Keeping projections in step: in the unit of a write that changes what one derives from, and from the change log for
// commits another process made. What each has read up to is a row, written in the same transaction as what it derives,
// so a crash can't leave the two apart.
import type { EarsEngine, LoggedChanges } from '@apackdev/ears';
import type { ProjectionDefinition } from '../framework/projections.ts';
import { SDK_ENTITIES } from '../types/sdk-entities.ts';
import { _isHostBound, boundHost } from './host-runtime.ts';

/** More than the change log holds, so one read is everything since any cursor */
const WHOLE_LOG = 8192;

interface Declared { name: string; projection: ProjectionDefinition }

const declared = (): readonly Declared[] => (_isHostBound() ? boundHost().packs.projections() : []);
const typeOf = (id: string) => id.slice(0, id.indexOf('-'));
const cursorRow = (name: string) => `${SDK_ENTITIES.ProjectionCursor}-${name}` as never;

function bringUp(engine: EarsEngine, { name, projection }: Declared, inWrite: boolean): void {
  const from = new Set(projection.from);
  const row = cursorRow(name);
  const cursor = (engine.query.ids(row).pickOne() as { through?: number } | undefined)?.through;
  const changes: LoggedChanges = engine.admin.changesSince(cursor ?? 0, WHOLE_LOG);
  const mine = Object.keys(changes.pending?.entities ?? {}).filter((id) => from.has(typeOf(id)));
  // A write that changed nothing this derives from leaves it, and other processes' commits, to their own catching up
  if (inWrite && mine.length === 0) return;

  const theirs = changes.commits.filter((commit) => commit.origin !== engine.admin.origin());
  const unknowable = cursor === undefined || changes.truncated
    || theirs.some((commit) => commit.everything || (commit.entities === undefined && commit.types.some((type) => from.has(type))));
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

/** @internal Brings every projection up to the change log: at boot, after the data was replaced, and told of another process */
export function _catchUpProjections(engine: EarsEngine): void {
  for (const each of declared()) engine.admin.transactWithoutHook(() => bringUp(engine, each, false));
}
