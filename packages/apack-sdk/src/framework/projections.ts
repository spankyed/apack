// Projections: rows a feature derives from other rows, kept in step whoever wrote them. A feature declares them with
// `defineProjections` and names the export in `apack.json` (`features.<id>.projections`).
//
// A write in this process runs a projection in its own transaction, so a row and what's derived from it commit together,
// like a database index. Anything else, a commit from another process (which can't run pack code) or one made while the
// projecting pack wasn't registered, is caught up on from what the database says changed since the projection last
// read, a chunk at a time. The database keeps that for a type whose `apack.json` entry sets `changeOrder`, which costs a
// write to it about a fifth more; a projection over a type without it is refused when its pack registers.
//
// `apply` and `reset` read and write the engine like any backend code, and are run again without warning: `apply` with
// ids it has seen. They hold the write lock, so they stay quick: `apply` is given a chunk of ids at a time.
//
// Deriving everything again — the first time, after `version` changes, or when what changed can't be known — is
// `apply` over every entity of the `from` types, a chunk per unit, so it never holds a write up for longer than a chunk.
// What it derived is part-built meanwhile.
//
// An entity counts as changed when a field, its trash state or a relation at either end changed. A projection that
// writes relations itself hears its own writes as part of the unit that made them, and not again.

/** Rows derived from others */
export interface ProjectionDefinition {
  /** The entity types it derives from: a write to none of them doesn't run it */
  readonly from: readonly string[];
  /** Brings what's derived from these entities up to date. Each is read as it is now, and may be gone */
  apply(ids: readonly string[]): void;
  /**
   * Clears everything it derived, before it derives everything again. Only a projection whose rows can outlive what
   * they derive from needs one: an entity destroyed before the pass would leave its rows behind, since no `apply` names it
   */
  reset?(): void;
  /**
   * Which derivation `apply` makes, 1 unless given. Raise it when what it derives changes, so what was derived before
   * is derived again
   */
  readonly version?: number;
}

/** A feature's projections by name */
export type ProjectionDefinitions = Readonly<Record<string, ProjectionDefinition>>;

/** A feature's projections, as `apack.json` `features.<id>.projections` names them */
export function defineProjections<const T extends ProjectionDefinitions>(projections: T): T {
  return projections;
}
