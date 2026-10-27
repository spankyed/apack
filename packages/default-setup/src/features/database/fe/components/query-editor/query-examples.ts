export interface QueryExample {
  title: string;
  description: string;
  query: string;
}

export const queryExamples: QueryExample[] = [
  {
    title: 'Recent Messages',
    description: 'Get messages ordered by timestamp',
    query: `return query(EARS.Entity.Message).orderBy('timestamp', 'desc').limit(10).pick(['text', 'sender', 'timestamp']);`
  },
  {
    title: 'Active Threads',
    description: 'Get active threads',
    query: `return query(EARS.Entity.Thread).where('status', 'active').limit(5).pickAll();`
  },

  {
    title: 'Explain a Query',
    description: 'How the database found a query\'s answer: the index each stage read, what it visited and kept',
    query: `return query(EARS.Entity.Thread).where('pinned', true).limit(20).explain();`
  },

  // Relation Queries
  {
    title: 'Thread Messages',
    description: 'Get messages contained in a specific thread',
    query: `const threadId = query(EARS.Entity.Thread).first();\nreturn query.ids(threadId).out('contains', EARS.Entity.Message).pick(['text', 'sender', 'timestamp']);`
  },
  {
    title: 'Thread Hierarchy',
    description: 'Get child threads of a parent thread',
    query: `const threadId = query(EARS.Entity.Thread).first();\nreturn query.ids(threadId).out('parent_of', EARS.Entity.Thread).pick(['topic', 'status']);`
  },

  // Advanced Queries
  {
    title: 'Flows with Node Counts',
    description: 'List flows with the number of nodes in each',
    query: `return query(EARS.Entity.Flow).pick(['label', 'description']).map(f => ({\n  ...f,\n  nodeCount: query.ids(f.id).out('contains', EARS.Entity.Node).count()\n}));`
  },
];
