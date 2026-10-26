export interface TransactionExample {
  title: string;
  description: string;
  query: string;
}

export const transactionExamples: TransactionExample[] = [
  // Basic Creation
  {
    title: 'Reset Settings',
    description: 'Reset all settings by destroying all entries in the Settings collection',
    query: `return query('Settings').ids().forEach(id => write(id).destroy());`
  },


  // Updates
  {
    title: 'Update Entity Attributes',
    description: 'Update existing entity attributes',
    query: `// Find an entity to update
const threads = query(EARS.Entity.Thread).limit(1).ids();
if (threads.length === 0) {
  return { error: 'No threads found to update' };
}

const threadId = threads[0];
const before = query.ids(threadId).pickOne(['status', 'updatedAt']);

// Update the thread
// Every attribute write stamps updatedAt
write(threadId)
  .set('status', 'resolved')
  .set('resolvedBy', 'admin');

const after = query.ids(threadId).pickOne(['status', 'updatedAt', 'resolvedBy']);

return { threadId, before, after };`
  },

  // Roles
  {
    title: 'Move a Role',
    description: 'Grant a role to one entity, taking it from the others (roles are declared in apack.json)',
    query: `// The root flow is the flow holding the root_flow role; a role a pack didn't declare is refused
const current = query.all().withRole(EARS.RoleKind.ROOT_FLOW).first();
const next = query(EARS.Entity.Flow).ids().find((id) => id !== current);
if (!next) return { current, moved: false };

write(next).grantExclusive(EARS.RoleKind.ROOT_FLOW, query.all().withRole(EARS.RoleKind.ROOT_FLOW).ids());

return { previous: current, current: next, roles: getRoles(next) };`
  },

  // Complex Operations
  {
    title: 'Create Entity with Relations',
    description: 'Create an entity with attributes, roles, and relations',
    query: `// Create the nodes
const startId = create(EARS.Entity.Node, { nodeType: 'listener', label: 'Begin Onboarding' }).id();
const actionId = create(EARS.Entity.Node, { nodeType: 'action', label: 'Collect Information' }).id();

// Create a flow holding them: a created row holds every field its type requires, and create numbers its shortCode
const flowId = create(EARS.Entity.Flow, {
  label: 'Customer Onboarding',
  flowType: 'workflow',
  description: 'Automated customer onboarding flow',
})
  .link(EARS.RelKind.CONTAINS, startId)
  .link(EARS.RelKind.CONTAINS, actionId)
  .id();

return query.ids(flowId).pickAll();`
  },


  // Numbered rows
  {
    title: 'Create a Numbered Row',
    description: "A row whose type declares a short code is numbered when it brings none",
    query: `// A Document's shortCode is numbered by create: DOC-<n>
const docId = create(EARS.Entity.Document, { name: 'Smart Doc', content: [] }).id();

// Update several fields; { touch: false } writes without stamping updatedAt
write(docId).setMany({ tags: ['ai'] });
write(docId, { touch: false }).set('displayOrder', 0);

return query.ids(docId).pick(['shortCode', 'name', 'tags']);`
  },

  // Safe Operations
  {
    title: 'Safe Link Creation',
    description: 'Create relations with cycle prevention',
    query: `// Create a hierarchy
const thread = (topic) => create(EARS.Entity.Thread, { topic, instructions: '', status: 'active', timestamp: Date.now() }).id();
const root = thread('Root Thread');
const child = thread('Child Thread');
const grandchild = thread('Grandchild Thread');

// parent_of is declared acyclic: a link that would form a cycle through it is refused
write(root).link(EARS.RelKind.PARENT_OF, child);
write(child).link(EARS.RelKind.PARENT_OF, grandchild);

// This would fail due to cycle prevention
try {
  write(grandchild).link(EARS.RelKind.PARENT_OF, root);
} catch (error) {
  return {
    hierarchy: {
      root,
      child,
      grandchild
    },
    cyclePreventionWorking: true,
    error: error.message
  };
}

return { error: 'Cycle prevention did not work as expected' };`
  }
];
