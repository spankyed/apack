// Projections: rows a feature derives from other rows, kept in step whoever wrote them. A feature declares them with
// `defineProjections` and names the export in `apack.json` (`features.<id>.projections`).
//
// A write in this process runs a projection in its own transaction, so a row and what's derived from it commit together,
// like a database index. Anything else, a commit from another process (which can't run pack code) or one made while the
// projecting pack wasn't registered, is caught up on from what the database says changed since the projection last
// read, a chunk at a time. The database keeps that for a type whose `apack.json` entry sets `changeOrder`, which costs a
// write to it about a fifth more; a projection over a type without it is refused when its pack registers.
//
// `apply` and `rebuild` read and write the engine like any backend code, and are run again without warning: `apply` with
// ids it has seen, and `rebuild` from nothing. They hold the write lock, so they stay quick.
//
// An entity counts as changed when a field, its trash state or a relation at either end changed. A projection that
// writes relations itself hears its own writes as part of the unit that made them, and not again.

/** Rows derived from others */
export interface ProjectionDefinition {
  /** The entity types it derives from: a write to none of them doesn't run it */
  readonly from: readonly string[];
  /** Brings what's derived from these entities up to date. Each is read as it is now, and may be gone */
  apply(ids: readonly string[]): void;
  /** Derives everything again: the first time it runs, after `version` changes, and when what changed can't be known */
  rebuild(): void;
  /**
   * Which derivation `apply` and `rebuild` make, 1 unless given. Raise it when what they derive changes, so what was
   * derived before is derived again
   */
  readonly version?: number;
}

/** A feature's projections by name */
export type ProjectionDefinitions = Readonly<Record<string, ProjectionDefinition>>;

/** A feature's projections, as `apack.json` `features.<id>.projections` names them */
export function defineProjections<const T extends ProjectionDefinitions>(projections: T): T {
  return projections;
}
