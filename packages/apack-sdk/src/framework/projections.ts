// Projections: rows a feature derives from other rows, kept in step whoever wrote them. A feature declares them with
// `defineProjections` and names the export in `apack.json` (`features.<id>.projections`).
//
// A write in this process runs a projection in its own transaction, so a row and what's derived from it commit together,
// like a database index. A commit from another process, which can't run pack code, is caught up on from the change log.
//
// `apply` and `rebuild` read and write the engine like any backend code, and are run again without warning: `apply` with
// ids it has seen, and `rebuild` from nothing. They hold the write lock, so they stay quick.
//
// What a projection hears is which entities changed. A change to a relation alone names no entity, so a projection
// derives from entities' fields, and whatever relations it writes are its own output, which nothing else should write.
// Writes this process made while the projecting pack wasn't registered aren't run again when it is.

/** Rows derived from others */
export interface ProjectionDefinition {
  /** The entity types it derives from: a write to none of them doesn't run it */
  readonly from: readonly string[];
  /** Brings what's derived from these entities up to date. Each is read as it is now, and may be gone */
  apply(ids: readonly string[]): void;
  /** Derives everything again, for when what changed can't be known */
  rebuild(): void;
}

/** A feature's projections by name */
export type ProjectionDefinitions = Readonly<Record<string, ProjectionDefinition>>;

/** A feature's projections, as `apack.json` `features.<id>.projections` names them */
export function defineProjections<const T extends ProjectionDefinitions>(projections: T): T {
  return projections;
}
