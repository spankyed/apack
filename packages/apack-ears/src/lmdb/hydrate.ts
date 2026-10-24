import { EARS } from '../entities.ts';
import type { LmdbDbs } from './envs.ts';
import type { EarsAdmin } from '../engine.ts';

/** Loads the environment's entities and relations into `engine`; a large value is loaded as its marker, unread */
export async function hydrate(params: {
  engine: EarsAdmin;
  env: LmdbDbs;
  /** Where the counts and the relations it skips go; `console.log` by default */
  log?: (message: string) => void;
}) {
  const { engine, env, log = console.log } = params;

  let entityCount = 0;
  let attrCount = 0;
  let untyped = 0;
  for (const { key, value: record } of env.rows.getRange()) {
    // Attributes written to an id no entity was created with are kept and not loaded, as the engine never held them
    if (record.type === null) { untyped++; continue; }
    const id = key as EARS.EntityId;
    for (const [kind, value] of record.fields) engine.bulkLoadAttr(id, kind as EARS.AttrKind, value);
    for (const [kind, size, length] of record.outOfLine) engine.bulkLoadOutOfLine(id, kind as EARS.AttrKind, size, length ?? undefined);
    entityCount++;
    attrCount += record.fields.length + record.outOfLine.length;
  }
  if (untyped) log(`[Hydrate] Skipped the attributes of ${untyped} ids no entity was created with`);

  let relCount = 0;
  for (const { key: relId, value: r } of env.relationRows.getRange()) {
    engine.bulkLoadRelation(relId as EARS.RelationId, r.kind, r.source as EARS.EntityId, r.target as EARS.EntityId, r.info ?? undefined);
    relCount++;
  }

  log(`[LMDB] Hydrated ${entityCount} entities (${attrCount} attributes), ${relCount} relations`);
}
