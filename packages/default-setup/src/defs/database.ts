/**
 * The Database console's type surface for Monaco: exactly the names console code can use, so the editor's types and
 * what the code actually gets are one list. The runners provide them (`@apackdev/sdk/database-console`), and
 * `apack.json`'s `dsl.database.globals` names them all (`tests/defs/database-console-globals.spec.ts`).
 */

export { EARS } from '@apackdev/sdk/types';
export type { BaseEntity, QueryBuilder, RelationMatch, RelationRow, RelationStats } from '@apackdev/ears';

// Read: the pack's typed helpers where there are any, the engine's otherwise
export { query, getAttr } from '#generated/ears.ts';
export { getRow, getRoles, getRelation, findRelations } from '@apackdev/sdk/ears';
export { getSchemaStats } from '@apackdev/sdk/ears';
export { engineCalls } from '@apackdev/sdk/database-console';

// Write: only a transaction gets these; a query naming one fails with "<name> is not defined"
export { create, upsert, write } from '#generated/ears.ts';
export { removeRelation } from '@apackdev/sdk/ears';
