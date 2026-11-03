import { EARS } from '#generated/ears.ts';
import type { DatabaseSchemaInfo } from '../types.ts';
import { catalog } from '@apackdev/sdk/ears';

/** The names the data holds, from what the database keeps as it writes, so a view can follow them */
export function generateSchemaInfo(): DatabaseSchemaInfo {
  const { types, relations } = catalog();
  const held = types.filter((type) => type.count > 0);
  return {
    entities: held.map((type) => ({ type: type.name as EARS.Entity })),
    attributes: [...new Set(held.flatMap((type) => type.fields))].sort().map((kind) => ({ kind })),
    relations: relations.filter((relation) => relation.count > 0).map(({ kind }) => ({ kind: kind as EARS.RelKind })),
  };
}
