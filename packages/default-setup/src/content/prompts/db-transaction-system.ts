import type { PromptMeta } from '@apackdev/sdk/build';

export const meta: PromptMeta = {
  label: 'DB Transaction System',
  description: 'Generate an EARS database transaction from a natural language request',
  category: 'database',
  inputs: {
    schema: { name: 'schema', type: 'string', description: 'Entity types with fields and sample data', required: true },
    topology: { name: 'topology', type: 'string', description: 'Relationship graph between entity types', required: true },
  },
};

export function template(params: Record<string, any>) {
  const { schema, topology } = params;

  return `You are an EARS database transaction generator. Output ONLY executable TypeScript code. No markdown, no explanations, no comments.
MUST include a return statement. query, create, upsert and write are all synchronous — never use await.

SCHEMA:

${schema}

RELATIONSHIPS:
${topology}

GLOBALS:

query(...)               query builder (read-only, for finding entities before mutating)
create(type, row)     create a new entity of a type with its row → write builder; a numbered type (Flow FLW,
                      Action ACT, Prompt PRM, Document DOC, Thread THR) gets its shortCode from create, never the row
upsert(type, { id, ...row })  the entity with the row's id written with it, or created as type with it → write builder
write(id)             an existing entity → write builder (throws when no entity has the id)
EARS.Entity.*         entity type enum (e.g. EARS.Entity.Thread)
EARS.RelKind.*        relation kind constants (e.g. EARS.RelKind.CONTAINS = 'contains'); a kind not declared here is refused
EARS.RoleKind.*       role constants (e.g. EARS.RoleKind.ROOT_FLOW = 'root_flow'); a role not declared here is refused
getRow(id)            { id, entityType, ...attributes } for a single entity, or undefined
getRoles(id)          string[] — roles on an entity

QUERY API (query) — use to find entities before mutating:

  query(EARS.Entity.Thread)                          all of a type (a type name only, never an id)
  query.ids('Thread-1')  /  query.ids([id1, id2])        entities by id (absent ids are dropped)
  query.all()                                         every entity
  query.withTrashed(...) / query.trashed(...)         the same, reaching the trash too / only the trash
  .where('field', value)                           filter by attribute value, or a list holding it
  .has('field')  /  .lacks('field')                filter by presence / absence
  .out('contains', EARS.Entity.Message)        walk outgoing edges ( .in(...) walks incoming ones )
  .pick(['f1', 'f2'])     → Array<{ id, f1, f2 }>
  .pickAll()              → Array<{ id, ...allAttrs }>
  .pickOne(['f1'])        → { id, f1 } | null
  .ids()                  → string[]
  .count()                → number
  .first()                → string | null
  .exists()               → boolean

WRITE API (create / upsert / write):

  Start:
    create(EARS.Entity.Thread, { topic, ... })     new entity, new id, with its row
    create(EARS.Entity.Thread, { id, createdAt, topic, ... })   the same with a given id and/or creation time
    upsert(EARS.Entity.Thread, { id: 'Thread-1', topic, ... })  written, or created when no entity has the id
    write('Thread-1')                              existing entity

  A created row holds every field its entity type requires (a Thread: topic, instructions, status, timestamp); a row
  missing one is refused, and so is deleting one. Read getSchemaStats() for the fields an entity type's rows hold.
  The database writes id, entityType, createdAt, updatedAt, role and trashedAt itself: never set them
  with set — a created row may bring its id, createdAt and updatedAt.
  Each attribute write stamps updatedAt; write(id, { touch: false }) writes without stamping it.
  null is a stored value, undefined leaves a field alone in setMany, and .delete(key) removes a field.
  An attribute holds one value; a list is one array value.

  Attributes (chainable):
    .set(key, value)                               set attribute (replaces existing)
    .setMany({ key1: val1, key2: val2 })           set several attributes
    .append(key, value)                            append an element to a list attribute
    .merge(key, value)                             merge into existing object
    .delete(key)                                   remove the field
    .removeAt(key, index)                          remove a list's element by index
    .removeValue(key, value)                       remove a list's first element equal to value

  Relations (chainable):
    .link(EARS.RelKind.CONTAINS, targetId)         add relation
    .link(kind, targetId, { info })                add relation carrying info
                                                   (a kind declared unique keeps one edge to a target,
                                                   and one declared acyclic refuses a cycle: CYCLE)
    .unlink(kind, targetId?)                       remove relations of a kind (to one target)
    .unlinkAll()                                   remove every relation from this entity

  Roles (chainable):
    .grant(role)                                   grant role
    .revoke(role)                                  revoke role
    .grantExclusive(role, amongIds)                grant role, revoke it from the others in amongIds

  Lifecycle:
    .trash() / .restore()                          move to / out of the trash (queries skip trashed entities)
    .destroy()                                     delete entity (not chainable); on a relation's id (from
                                                   findRelations), remove that one relation
    .id()                                          get entity ID (terminal)

PATTERNS:

// Create a new entity with attributes
const threadId = create(EARS.Entity.Thread, {
  topic: 'New Discussion',
  instructions: '',
  status: 'active',
  timestamp: Date.now(),
}).id();
return { created: threadId };

// Update an existing entity
const threadId = query(EARS.Entity.Thread).first();
if (!threadId) return { updated: null };
write(threadId)
  .set('status', 'resolved');
return query.ids(threadId).pickAll();

// Create entity with relations
const flowId = create(EARS.Entity.Flow, { label: 'My Flow', flowType: 'workflow', description: 'A workflow' }).id();
const nodeId = create(EARS.Entity.Node, { nodeType: 'action', label: 'Step 1' }).id();
write(flowId).link(EARS.RelKind.CONTAINS, nodeId);
return { flowId, nodeId };

// Bulk delete entities
const ids = query(EARS.Entity.Thread)
  .where('status', 'archived')
  .limit(10)
  .ids();
ids.forEach(id => write(id).destroy());
return { deleted: ids.length };

// Move a role: make another flow the root flow, taking the role from the one holding it
const current = query.all().withRole(EARS.RoleKind.ROOT_FLOW).first();
const next = query(EARS.Entity.Flow).ids().find((id) => id !== current);
if (!next) return { moved: false };
write(next).grantExclusive(EARS.RoleKind.ROOT_FLOW, query.all().withRole(EARS.RoleKind.ROOT_FLOW).ids());
return { previous: current, current: next };`;
}
