import { featureSettings } from '#generated/settings.ts';

import { create, write, query, transact } from '#generated/ears.ts';

import { EARS } from '#generated/ears.ts';
import { RepositoryError, RepositoryErrorCode } from '@apackdev/sdk/repositories';
import { wouldCreateCycle } from '@apackdev/sdk/ears';
import { createLogger } from '@apackdev/sdk/logger';
import type {
  ThreadEntity, MessageEntity, ArtifactEntity, BlockConfig, MessageReferences,
  ThreadCreateData,
  ThreadExtendedData,
  ThreadExtended,
  AgentThreadData, ArtifactType, ThreadLinkRelation, ThreadRelation,
  ChatPage, ChatStart, MessageSearchResult, ThreadDetailView, ThreadTabView,
} from '../types.ts';
import { ThreadRelations } from '../types.ts';
import type { ArtifactItem } from '@apackdev/sdk/artifacts';

/**
 * Threads Repository
 */

function findArtifactByThreadAndType(
  threadId: EARS.EntityId,
  artifactType: ArtifactType,
): ArtifactEntity | undefined {
  const candidates = query.ids(threadId)
    .out(EARS.RelKind.HAS, EARS.Entity.Artifact).pick(['artifactType'] as const)
    .filter(({ artifactType: t }) => t === artifactType);
  const first = candidates[0];
  if (!first?.id) return undefined;
  return query.ids([first.id as EARS.EntityId<'Artifact'>]).pickAll()[0];
}

// Queries
export const threadQueries = {
  byId: (id: EARS.EntityId): ThreadEntity | undefined =>
    query.ids(id).ofType(EARS.Entity.Thread).pickOne() ?? undefined,
  
  all: (): ThreadEntity[] =>
    query(EARS.Entity.Thread).pickAll().filter(t => !t.archived),

  allUnfiltered: (): ThreadEntity[] =>
    query(EARS.Entity.Thread).pickAll(),

  /** The first thread holding the role, e.g. the onboarding birth thread */
  idByRole: (role: EARS.RoleKind): EARS.EntityId | undefined =>
    query.all().withRole(role).first(),

  // Get thread messages
  messages: (threadId: EARS.EntityId) => 
    query.ids(threadId)
      .out(EARS.RelKind.CONTAINS, EARS.Entity.Message)
      .pick(["text", "sender", "timestamp", "compacted", "isCommand"] as const),
  
  /** The threads this one links to, by kind, then the threads that block it, as `blocked by` */
  linkedThreads: (threadId: EARS.EntityId): Array<{ relation: ThreadLinkRelation } & Pick<ThreadEntity, 'id' | 'shortCode' | 'topic' | 'status' | 'timestamp'>> => {
    const out = query.ids(threadId).outEdges(ThreadRelations, EARS.Entity.Thread)
      .map(({ kind, target }) => ({ relation: kind as ThreadLinkRelation, id: target }));
    const blockers = query.ids(threadId).inEdges(EARS.RelKind.BLOCKS, EARS.Entity.Thread)
      .map(({ source }) => ({ relation: 'blocked by' as const, id: source }));
    return [...out, ...blockers].flatMap(({ relation, id }) => {
      const row = query.ids(id).pickOne(["shortCode", "topic", "status", "timestamp"] as const);
      return row ? [{ relation, ...row }] : [];
    });
  },
  
  // Get extended data
  extendedData: (
    threadId: EARS.EntityId,
    include?: keyof ThreadExtendedData | (keyof ThreadExtendedData)[]
  ): ThreadExtendedData => {
    const want = (k: keyof ThreadExtendedData) =>
      !include ? true : Array.isArray(include) ? include.includes(k) : include === k;

    const thread = threadQueries.byId(threadId);
    return {
      messages: want("messages") ? threadQueries.messages(threadId) : [],
      linkedThreads: want("linkedThreads") ? threadQueries.linkedThreads(threadId) : [],
      // Core thread fields so SET_VIEW_DATA can populate the view fully
      topic: thread?.topic,
      instructions: thread?.instructions,
      status: thread?.status,
      pinned: thread?.pinned,
      archived: thread?.archived,
      shortCode: thread?.shortCode,
      timestamp: thread?.timestamp,
      lastMessageTimestamp: thread?.lastMessageTimestamp,
      tags: thread?.tags as string[] | undefined,
    };
  },

  /** The archived threads, in the order the chat's settings sort recent threads */
  archivedThreads: (sortOrder: RecentThreadsSortOrder): Partial<ThreadEntity>[] => getArchivedThreads(sortOrder),

  /** The threads the list and the board show: every one not archived, newest first, each with its parent's id */
  listed: (): ThreadExtended[] => {
    const threads = query(EARS.Entity.Thread).pickAll().filter(t => !t.archived);
    // A thread's parent is the one linking to it with 'parent_of': every thread's, in one read, the first kept
    const parents = new Map<string, string>();
    for (const { source, target } of query.ids(threads.map(t => t.id)).inEdges(EARS.RelKind.PARENT_OF, EARS.Entity.Thread)) {
      if (!parents.has(target)) parents.set(target, source);
    }
    return threads
      .map(thread => {
        const parentId = parents.get(thread.id);
        return { ...thread, ...(parentId !== undefined ? { parentId } : {}) } as ThreadExtended;
      })
      .sort((a, b) => ((b.timestamp as number) || 0) - ((a.timestamp as number) || 0));
  },

  /** A thread as its detail page shows it, or `null` once it is gone */
  detail: (threadId: EARS.EntityId): ThreadDetailView | null => {
    if (!threadQueries.byId(threadId)) return null;
    const { messages: _messages, ...fields } = threadQueries.extendedData(threadId, 'linkedThreads');
    return { ...fields, id: threadId as ThreadEntity['id'], messageIds: displayOrder(threadId).map(m => m.id) };
  },

  /**
   * Compatibility alias for persisted action code compiled before artifact
   * helpers moved under chatCommands.
   */
  findArtifactByType: findArtifactByThreadAndType,
} as const;

// Commands
const logger = createLogger('threads-repository');

const codeOf = (id: EARS.EntityId): string => (query.ids(id).ofType(EARS.Entity.Thread).pickOne(['shortCode'] as const)?.shortCode as string | undefined) ?? id;

/**
 * Refuses a `blocks` or `parent_of` link from `source` to `target` that would close a loop, naming the threads
 * already leading from `target` back to `source`: "THR-3 already blocks THR-1 through THR-2"
 */
function refuseLoop(source: EARS.EntityId, kind: ThreadRelation, target: EARS.EntityId): void {
  if (source === target) {
    const verb = kind === EARS.RelKind.BLOCKS ? 'block' : kind === EARS.RelKind.PARENT_OF ? 'be the parent of' : 'duplicate';
    throw new RepositoryError(`${codeOf(source)} can't ${verb} itself`, RepositoryErrorCode.VALIDATION_ERROR);
  }
  if (kind === EARS.RelKind.DUPLICATES || !wouldCreateCycle(source, target, [kind])) return;
  const path = query.ids(target).pathTo(source, kind).ids() as EARS.EntityId[];
  const through = path.slice(1, -1).map(codeOf);
  const via = through.length ? ` through ${through.join(', ')}` : '';
  const [from, to] = [codeOf(target), codeOf(source)];
  const message = kind === EARS.RelKind.BLOCKS
    ? `${from} already blocks ${to}${via}`
    : `${from} is already ${through.length ? 'an ancestor' : 'the parent'} of ${to}${via}`;
  throw new RepositoryError(message, RepositoryErrorCode.VALIDATION_ERROR);
}

/**
 * Links a thread to the threads it names, `blocked by` as the other thread's `blocks`, refusing a link that would
 * close a loop and skipping one to a thread that no longer exists: the list comes from a form that may have been open
 * while that thread was deleted, and a save shouldn't fail for it.
 */
function linkThreads(id: EARS.EntityId, linked: ReadonlyArray<{ relation: ThreadLinkRelation; id: EARS.EntityId }>): void {
  for (const rel of linked) {
    if (!query.ids(rel.id).exists()) {
      logger.warn('Skipped a link to a thread that no longer exists', { threadId: id, linked: rel.id, relation: rel.relation });
      continue;
    }
    const [source, kind, target] = rel.relation === 'blocked by'
      ? [rel.id, EARS.RelKind.BLOCKS, id] as const
      : [id, rel.relation, rel.id] as const;
    refuseLoop(source, kind, target);
    write(source).link(kind, target);
  }
}

export const threadCommands = {
  /** `id` and `createdAt` keep an imported thread's own; a new thread gets fresh ones */
  create: (input: ThreadCreateData & { id?: string; createdAt?: number }): { id: EARS.EntityId; shortCode: string; timestamp: number, status: string } => transact(() => {
    if (!input.topic?.trim()) {
      throw new RepositoryError('Topic is required', RepositoryErrorCode.VALIDATION_ERROR);
    }

    const ts = Date.now();

    const status = input.status || featureSettings.forFeature('threads').get()?.statuses[0]?.label || '';
    // `create` numbers its short code
    const { id, shortCode } = create(EARS.Entity.Thread, {
      ...(input.id ? { id: input.id as EARS.EntityId<'Thread'> } : {}),
      createdAt: input.createdAt ?? ts,
      status,
      timestamp: ts,
      lastMessageTimestamp: ts,
      topic: input.topic,
      instructions: input.instructions,
      tags: input.tags || [],  // Store tags as array of names
      ...(input.forcedMode && { forcedMode: input.forcedMode }),  // Set forced mode if provided
      ...(input.pinned && { pinned: input.pinned })
    }).row();

    // Grant role if provided
    if (input.role) {
      write(id).grant(input.role);
    }

    // Create relationships for linked threads only; a refused one undoes the thread with them
    linkThreads(id, input.linkedThreads ?? []);

    return { id, shortCode, timestamp: ts, status };
  }),

  /** Adds links to a thread, keeping the ones it has; a link that would close a loop is refused, and none is added */
  addLinks: (id: EARS.EntityId, linked: ReadonlyArray<{ relation: ThreadLinkRelation; id: EARS.EntityId }>): void =>
    transact(() => linkThreads(id, linked)),
  
  update: (id: EARS.EntityId, updates: {
    topic?: string;
    instructions?: string;
    status?: string; // Dynamic status from settings
    tags?: string[];  // Tag names from settings
    linkedThreads?: any[];
    lastMessageTimestamp?: number;
    lastVisitedTimestamp?: number;
    forcedMode?: ThreadEntity['forcedMode'] | null;
    context?: ThreadEntity['context'];  // Free-form per-feature state (ThreadContext)
    archived?: boolean;
    chatState?: string;
  }): void => {
    if (!threadQueries.byId(id)) {
      throw new RepositoryError(`Thread ${id} not found`, RepositoryErrorCode.NOT_FOUND);
    }

    const { linkedThreads, ...fieldUpdates } = updates;

    // Update fields (including tags as a direct field). The shape holds no field as null, so a null clears one: an
    // action, which no compiler checks, clears forcedMode that way
    const cleared = Object.entries(fieldUpdates).filter(([, value]) => value === null).map(([field]) => field);
    const set = Object.fromEntries(Object.entries(fieldUpdates).filter(([, value]) => value !== null));
    if (Object.keys(set).length > 0) write(id).setMany(set);
    const held = cleared.length ? query.ids(id).pickOne(cleared as never[]) as Record<string, unknown> | undefined : undefined;
    for (const field of cleared) {
      if (held && Object.prototype.hasOwnProperty.call(held, field)) write(id).delete(field as never);
    }

    // The links the form lists replace the thread's, the blocks on it included, in one unit: a link refused for
    // closing a loop leaves every link as it was. Its other fields are written by then, and stay
    if (linkedThreads !== undefined) {
      transact(() => {
        for (const link of query.ids(id).outEdges(ThreadRelations)) write(id).unlink(link.kind, link.target);
        for (const link of query.ids(id).inEdges(EARS.RelKind.BLOCKS)) write(link.source).unlink(EARS.RelKind.BLOCKS, id);
        linkThreads(id, linkedThreads);
      });
    }
  },

  markAsVisited: (id: EARS.EntityId): void => {
    if (!threadQueries.byId(id)) {
      throw new RepositoryError(`Thread ${id} not found`, RepositoryErrorCode.NOT_FOUND);
    }

    write(id).set('lastVisitedTimestamp', Date.now());
  },

  linkFork: (sourceThreadId: EARS.EntityId, forkedThreadId: EARS.EntityId): void => {
    write(forkedThreadId).link(EARS.RelKind.FORKED_FROM, sourceThreadId);
  },

  forkCount: (sourceThreadId: EARS.EntityId): number => {
    return query.ids(sourceThreadId).in(EARS.RelKind.FORKED_FROM, EARS.Entity.Thread).count();
  },

  setParent: (parentId: EARS.EntityId, childIds: EARS.EntityId[]): { reparented: string[]; skipped: string[] } => {
    const reparented: string[] = [];
    const skipped: string[] = [];

    for (const childId of childIds) {
      // Skip if trying to parent to self
      if (childId === parentId) {
        skipped.push(childId);
        continue;
      }

      // Check for cycles: would adding parentId -> childId create a loop?
      if (wouldCreateCycle(parentId, childId, [EARS.RelKind.PARENT_OF])) {
        skipped.push(childId);
        continue;
      }

      // Remove existing parent link (reverse direction: find who has parent_of pointing to this child)
      const oldParentIds = query.ids(childId).in(EARS.RelKind.PARENT_OF, EARS.Entity.Thread).ids();
      for (const oldParentId of oldParentIds) {
        write(oldParentId).unlink(EARS.RelKind.PARENT_OF, childId);
      }

      // Create new parent_of link
      write(parentId).link(EARS.RelKind.PARENT_OF, childId);
      reparented.push(childId);
    }

    return { reparented, skipped };
  },

  delete: (id: EARS.EntityId): void => {
    const thread = threadQueries.byId(id);
    if (!thread) {
      throw new RepositoryError(`Thread ${id} not found`, RepositoryErrorCode.NOT_FOUND);
    }
    if (thread.pinned) {
      throw new RepositoryError(`Cannot delete pinned thread ${id}`, RepositoryErrorCode.VALIDATION_ERROR);
    }

    // 1. Delete all messages linked to this thread
    const messages = query.ids(id).out(EARS.RelKind.CONTAINS, EARS.Entity.Message).ids();
    for (const messageId of messages) {
      write(messageId).destroy();
    }

    // 2. Remove all thread relationships (parent_of, blocks, duplicates)
    // First, unlink this thread from any threads it links to
    const existingLinks = query.ids(id).outEdges(ThreadRelations);
    for (const link of existingLinks) {
      write(id).unlink(link.kind, link.target);
    }

    // Also unlink any threads that link to this thread
    // Find threads that have this thread as a linked thread
    const allThreads = query(EARS.Entity.Thread).pickAll();
    for (const thread of allThreads) {
      const linkedToThis = query.ids(thread.id).outEdges(ThreadRelations);
      for (const link of linkedToThis) {
        if (link.target === id) {
          write(thread.id).unlink(link.kind, id);
        }
      }
    }

    // 3. Delete any artifacts linked to this thread
    const artifacts = query.all().linkedWith(id).ofType(EARS.Entity.Artifact).ids();
    for (const artifactId of artifacts) {
      write(artifactId).destroy();
    }

    // 4. Finally, delete the thread entity itself
    write(id).destroy();
  },

  /** Destroy a thread record left without data (a stale role holder); `delete` cleans up a real thread's links */
  destroyStale: (id: EARS.EntityId): void => {
    write(id).destroy();
  },
} as const;

// ---- Chat queries & commands (merged from agent system) ----

const THREAD_TOPIC_MAX_LENGTH = 40;
const RECENT_THREADS_FALLBACK_LIMIT = 7;

/** How the chat's settings order recent and archived threads */
export type RecentThreadsSortOrder = 'created' | 'visited' | 'message';

/** The recent-thread limit and order the threads settings hold, read where no view is asking */
function configuredRecentThreads(): { limit: number; sortOrder: RecentThreadsSortOrder } {
  const settings = featureSettings.forFeature('threads').get();
  const limit = settings?.recentThreadsLimit;
  const sortOrder = settings?.recentThreadsSortOrder;
  return {
    limit: typeof limit === 'number' && limit > 0 ? limit : RECENT_THREADS_FALLBACK_LIMIT,
    sortOrder: sortOrder === 'visited' || sortOrder === 'message' ? sortOrder : 'created',
  };
}

function getSortTimestamp(thread: Partial<ThreadEntity>, sortOrder: RecentThreadsSortOrder): number {
  switch (sortOrder) {
    case 'visited': return thread.lastVisitedTimestamp || thread.timestamp || 0;
    case 'message': return thread.lastMessageTimestamp || thread.timestamp || 0;
    case 'created':
    default: return thread.timestamp || 0;
  }
}

function getRecentThreads(limit: number, sortOrder: RecentThreadsSortOrder): Partial<ThreadEntity>[] {
  const threadFields = [
    "shortCode", "topic", "instructions", "status", "timestamp",
    "lastMessageTimestamp", "lastVisitedTimestamp", "forcedMode", "pinned", "archived", "chatState", "context",
  ] as const;

  const allThreads = query(EARS.Entity.Thread).pick(threadFields)
    .filter(t => !t.archived);

  return allThreads
    .sort((a, b) => getSortTimestamp(b, sortOrder) - getSortTimestamp(a, sortOrder))
    .slice(0, limit);
}

function getArchivedThreads(sortOrder: RecentThreadsSortOrder): Partial<ThreadEntity>[] {
  const threadFields = [
    "shortCode", "topic", "instructions", "status", "timestamp",
    "lastMessageTimestamp", "lastVisitedTimestamp", "forcedMode", "pinned", "archived", "chatState", "context",
  ] as const;

  return query(EARS.Entity.Thread).pick(threadFields)
    .filter(t => t.archived)
    .sort((a, b) => getSortTimestamp(b, sortOrder) - getSortTimestamp(a, sortOrder));
}

function getThreadArtifacts(threadId: EARS.EntityId): ArtifactItem[] {
  const artifacts = query(EARS.Entity.Artifact).linkedWith(threadId)
    .pick(['id', 'title', 'content', 'artifactType', 'createdAt', 'color'] as const);

  if (!artifacts || artifacts.length === 0) return [];

  return artifacts
    .map(artifact => ({
      id: artifact.id,
      type: (artifact.artifactType || 'text') as ArtifactType,
      title: String(artifact.title || ''),
      content: artifact.content,
      ...(artifact.color ? { color: artifact.color as string } : {}),
      metadata: { createdAt: (artifact.createdAt as number) || 0 }
    }))
    .sort((a, b) => b.metadata.createdAt - a.metadata.createdAt);
}

const messagePickFields = ["id", "text", "sender", "timestamp", "blocks", "blockResponse", "responseTimestamp", "forkable", "references", "isCommand", "command", "context", "autoHide", "asUser", "asideText", "asideContext", "status", "compacted"] as const;

function getThreadFields(threadId: EARS.EntityId): AgentThreadData | null {
  const thread = query.ids(threadId)
    .orderBy('timestamp', 'desc')
    .limit(4)
    .pick(["shortCode", "topic", "instructions", "status", "timestamp", "forcedMode", "pinned", "chatState", "context"] as const);
  return thread[0] as AgentThreadData | null;
}

function getAllThreadMessages(threadId: EARS.EntityId): Partial<MessageEntity>[] {
  return (query.ids(threadId)
    .out(EARS.RelKind.CONTAINS, EARS.Entity.Message).pick(messagePickFields) ?? [])
    .sort((a, b) => {
      if (a.status === 'queued' && b.status !== 'queued') return 1;
      if (b.status === 'queued' && a.status !== 'queued') return -1;
      return 0;
    }) as Partial<MessageEntity>[];
}

/**
 * A thread's last `limit` messages that aren't queued, chronological, then its queued ones, each with its status alone,
 * and whether earlier ones exist. Every write that adds a message moves the queued ones last (`relinkQueuedToEnd`), so
 * the thread is read from its last message back, in a window grown until it holds `limit` + 1 others or the thread
 * ends: opening a long thread costs its page. It reads no message's content, which is what keeps a view over it still
 * while a message streams.
 */
function lastPage(threadId: EARS.EntityId, limit: number) {
  for (let n = limit + 4; ; n *= 2) {
    const window = (query.ids(threadId).out(EARS.RelKind.CONTAINS, EARS.Entity.Message)
      .reverse().limit(n).pick(['status'] as const) ?? []) as Array<{ id: EARS.EntityId; status?: MessageEntity['status'] }>;
    const others = window.filter(m => m.status !== 'queued');
    if (others.length > limit || window.length < n) {
      return {
        page: others.slice(0, limit).reverse(),
        queued: window.filter(m => m.status === 'queued').reverse(),
        hasMore: others.length > limit,
      };
    }
  }
}

/**
 * A thread's messages in the order the chat shows them, each with its status alone: chronological, the queued ones
 * last. It reads no message's content, which is what keeps a view over it still while a message streams.
 */
function displayOrder(threadId: EARS.EntityId): Array<{ id: EARS.EntityId; status?: MessageEntity['status'] }> {
  const all = query.ids(threadId).out(EARS.RelKind.CONTAINS, EARS.Entity.Message).pick(['status'] as const) ?? [];
  const queued = all.filter(m => m.status === 'queued');
  return [...all.filter(m => m.status !== 'queued'), ...queued] as Array<{ id: EARS.EntityId; status?: MessageEntity['status'] }>;
}

/** How far before a snippet's first match its window starts, and how long the window is, in UTF-16 units */
const SNIPPET_LEAD = 40;
const SNIPPET_LENGTH = 180;

/** A message's text matched newer first: a score halves for each week a message is older */
const SEARCH_HALF_LIFE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * A window of `text` around its first mark, the marks inside it moved to the window's places: a mark the window cuts
 * is cut with it
 */
export function snippetOf(text: string, marks: ReadonlyArray<readonly [number, number]>) {
  const first = marks[0]?.[0] ?? 0;
  const start = Math.max(0, Math.min(first - SNIPPET_LEAD, text.length - SNIPPET_LENGTH));
  const end = Math.min(text.length, start + SNIPPET_LENGTH);
  const inside = marks
    .filter(([s, e]) => e > start && s < end)
    .map(([s, e]): [number, number] => [Math.max(s, start) - start, Math.min(e, end) - start]);
  return { snippet: text.slice(start, end), marks: inside, clippedStart: start > 0, clippedEnd: end < text.length };
}

/**
 * The messages a query matches, most relevant first and newer before older, with their threads: what the threads
 * panel's search lists. A compaction marker is no message a person wrote or read, and is left out
 */
function searchMessages(text: string, limit = 20): MessageSearchResult[] {
  if (!text.trim()) return [];
  const matches = (n: number) => query(EARS.Entity.Message)
    .search(text, { prefix: true, recency: { field: 'timestamp', halfLife: SEARCH_HALF_LIFE_MS } })
    .limit(n)
    .hits({ fields: ['text', 'sender', 'timestamp'], highlights: true });
  // A marker is matched like any message and left out after, so a page asks again for more until it is full or the
  // matches run out
  let n = limit;
  let hits = matches(n);
  while (hits.filter(hit => hit.row.sender !== 'marker').length < limit && hits.length === n) hits = matches(n *= 2);
  const kept = hits.filter(hit => hit.row.sender !== 'marker');
  // Each message's thread, the first it is contained by, and each thread's topic, for all of them in two reads
  const threadOf = new Map<string, EARS.EntityId>();
  for (const { source, target } of query.ids(kept.map(hit => hit.id)).outEdges(EARS.RelKind.CONTAINS, EARS.Entity.Thread)) {
    if (!threadOf.has(source)) threadOf.set(source, target);
  }
  const topics = new Map<string, string>(
    query.ids([...new Set(threadOf.values())]).ofType(EARS.Entity.Thread).pick(['topic'] as const)
      .map(t => [t.id, t.topic ?? ''] as const));
  const results: MessageSearchResult[] = [];
  for (const { id, row, highlights } of kept) {
    const threadId = threadOf.get(id);
    if (!threadId) continue;
    if (results.length === limit) break;
    const marks = (highlights?.text ?? []).map(([, s, e]) => [s, e] as [number, number]);
    results.push({
      messageId: id, threadId, topic: topics.get(threadId) ?? '', sender: row.sender, timestamp: row.timestamp,
      ...snippetOf(row.text ?? '', marks),
    });
  }
  return results;
}

export const chatQueries = {
  searchMessages,

  threadArtifacts: (threadId: EARS.EntityId) => {
    return getThreadArtifacts(threadId);
  },

  threadData: (threadId: EARS.EntityId): AgentThreadData | null => {
    const thread = getThreadFields(threadId);
    if (!thread) return null;

    return {
      ...thread,
      messages: getAllThreadMessages(threadId),
      artifacts: getThreadArtifacts(threadId) as any as ArtifactEntity[],
    };
  },

  /**
   * A thread as the chat shows it, or `null` once it is gone: its fields and the ids of its last \`limit\` messages
   * and its queued ones, in display order
   */
  chatPage: (threadId: EARS.EntityId, limit: number): ChatPage | null => {
    const thread = getThreadFields(threadId);
    if (!thread) return null;
    const { page, queued, hasMore } = lastPage(threadId, limit);
    return { ...thread, id: threadId as ThreadEntity['id'], messageIds: [...page, ...queued].map(m => m.id), hasMore };
  },

  /** An open tab's thread, or `null` once it is gone */
  tab: (threadId: EARS.EntityId): ThreadTabView | null => {
    const thread = query.ids(threadId).ofType(EARS.Entity.Thread).pickOne(['topic', 'pinned'] as const);
    if (!thread) return null;
    return { topic: thread.topic || '', ...(thread.pinned && { pinned: true }), artifacts: getThreadArtifacts(threadId) };
  },

  /** The recent threads, at most \`limit\`, in \`sortOrder\` */
  recentThreads: (limit: number, sortOrder: RecentThreadsSortOrder): Partial<ThreadEntity>[] => getRecentThreads(limit, sortOrder),

  /** The recent-thread limit and order the settings hold now */
  configuredRecentThreads,

  /**
   * What a window's chat starts from: the most recent thread, opened; the tabs every window opens — that thread's
   * and each pinned one's; and the threads settings
   */
  chatStart: (): ChatStart => {
    const { limit, sortOrder } = configuredRecentThreads();
    const current = getRecentThreads(limit, sortOrder)[0];
    const pinned = query(EARS.Entity.Thread).where('pinned', true)
      .pick(['topic', 'archived'] as const)
      .filter(t => !t.archived);
    const tabs: ChatStart['tabs'] = pinned.map(t => ({ id: t.id as ThreadEntity['id'], label: t.topic || 'No topic', pinned: true }));
    if (current?.id && !tabs.some(t => t.id === current.id)) {
      tabs.push({ id: current.id as ThreadEntity['id'], label: current.topic || `Thread ${current.shortCode || ''}` });
    }
    return {
      currentThreadId: (current?.id as ThreadEntity['id'] | undefined) ?? null,
      tabs,
      settings: featureSettings.forFeature('threads').get(),
    };
  },

  messageById: (messageId: EARS.EntityId): MessageEntity | null => {
    const message = query.ids(messageId).pickOne([
      'id', 'text', 'sender', 'timestamp', 'blocks', 'blockResponse',
      'responseTimestamp', 'createdAt', 'updatedAt', 'autoHide', 'asUser', 'asideText', 'asideContext',
      'forkable', 'references', 'isCommand', 'command', 'status', 'context', 'compacted'
    ] as const);

    if (!message) return null;

    return { ...message, entityType: EARS.Entity.Message } as MessageEntity;
  }
} as const;

/**
 * Move a message to the end of its thread's CONTAINS relation list.
 * Used to keep queued messages at the bottom of the conversation.
 */
function relinkMessageToEnd(threadId: EARS.EntityId, messageId: EARS.EntityId): void {
  write(threadId).unlink(EARS.RelKind.CONTAINS, messageId);
  write(messageId).unlink(EARS.RelKind.CONTAINS, threadId);
  write(threadId).link(EARS.RelKind.CONTAINS, messageId);
  write(messageId).link(EARS.RelKind.CONTAINS, threadId);
}

/**
 * Moves a thread's queued messages after the rest, in their order: what every write adding a message ends with. The
 * status index finds them, and the thread is read from its last message back only as far as the earliest of them
 */
function relinkQueuedToEnd(threadId: EARS.EntityId, except?: EARS.EntityId): void {
  const queued = query(EARS.Entity.Message).where('status', 'queued').linkedTo(EARS.RelKind.CONTAINS, threadId).ids()
    .filter(id => id !== except);
  if (!queued.length) return;
  const inOrder = query.ids(threadId).out(EARS.RelKind.CONTAINS, EARS.Entity.Message)
    .reverse().within(queued).limit(queued.length).ids().reverse();
  for (const id of inOrder) relinkMessageToEnd(threadId, id);
}

export const chatCommands = {
  addMessage: (params: {
    threadId: EARS.EntityId;
    text: string;
    sender: 'user' | 'assistant' | 'system' | 'marker';
    blocks?: BlockConfig[];
    forkable?: boolean;
    references?: MessageReferences;
    isCommand?: boolean;
    command?: string;
    autoHide?: boolean;
    asUser?: boolean;
    asideContext?: string;
    blockResponse?: any;
    responseTimestamp?: number;
    asideText?: string;
    compacted?: boolean;
    context?: Record<string, unknown>;
    skipRelink?: boolean;
  }): {
    id: EARS.EntityId;
    threadId: EARS.EntityId;
    text: string;
    sender: string;
    timestamp: number;
  } => {
    const { threadId, text, sender, blocks, forkable, references, isCommand, command, autoHide, asUser, asideContext, blockResponse, responseTimestamp, asideText, compacted, context, skipRelink } = params;

    const thread = query.ids(threadId).first();
    if (!thread) {
      throw new RepositoryError(`Thread ${threadId} not found`, RepositoryErrorCode.NOT_FOUND);
    }

    const validSenders = ['user', 'assistant', 'system', 'marker'];
    if (!validSenders.includes(sender)) {
      throw new RepositoryError(
        `Invalid sender type. Must be one of: ${validSenders.join(', ')}`,
        RepositoryErrorCode.VALIDATION_ERROR
      );
    }

    const timestamp = Date.now();
    const messageTx = create(EARS.Entity.Message, { text: text.trim(), timestamp, sender, createdAt: timestamp });

    if (blocks) messageTx.set('blocks', blocks);
    if (forkable !== undefined) messageTx.set('forkable', forkable);
    if (references) messageTx.set('references', references);
    if (isCommand) messageTx.set('isCommand', isCommand);
    if (command) messageTx.set('command', command);
    if (autoHide) messageTx.set('autoHide', autoHide);
    if (asUser) messageTx.set('asUser', asUser);
    if (asideContext) messageTx.set('asideContext', asideContext);
    if (blockResponse) messageTx.set('blockResponse', blockResponse);
    if (responseTimestamp) messageTx.set('responseTimestamp', responseTimestamp);
    if (asideText) messageTx.set('asideText', asideText);
    if (compacted) messageTx.set('compacted', compacted);
    if (context) messageTx.set('context', context);

    const messageId = messageTx.link(EARS.RelKind.CONTAINS, threadId).id();

    write(threadId).link(EARS.RelKind.CONTAINS, messageId);
    write(threadId).set('lastMessageTimestamp', timestamp);

    // Keep queued messages at the end of the relation list so they always render below the current agent turn, even
    // after a thread reload; a bulk add skips it for each message and moves them once after its last
    if (!skipRelink) relinkQueuedToEnd(threadId, messageId);

    return { id: messageId, threadId, text: text.trim(), sender, timestamp };
  },

  createThreadFromMessage: (text: string): {
    threadId: EARS.EntityId;
    threadData: ReturnType<typeof threadCommands.create>;
  } => {
    const topic = text.substring(0, THREAD_TOPIC_MAX_LENGTH).trim() || 'New Thread';
    const threadData = threadCommands.create({
      topic,
      instructions: '',
    });

    return { threadId: threadData.id, threadData };
  },

  updateMessageBlockResponse: (params: {
    messageId: EARS.EntityId;
    response: any;
  }): {
    messageId: EARS.EntityId;
    responseTimestamp: number;
    updatedAt: number;
    blocks?: BlockConfig[];
  } => {
    const { messageId, response } = params;

    const message = query.ids(messageId).first();
    if (!message) {
      throw new RepositoryError(`Message ${messageId} not found`, RepositoryErrorCode.NOT_FOUND);
    }

    const now = Date.now();

    write(messageId)
      .set('blockResponse', response)
      .set('responseTimestamp', now);

    let updatedBlocks: BlockConfig[] | undefined;
    const storedBlocks = query.ids(messageId).pickOne(['blocks'])?.blocks;

    if (Array.isArray(storedBlocks) && response.buttonId) {
      let buttonToggled = false;
      const newBlocks = (storedBlocks as BlockConfig[]).map((block: BlockConfig) => {
        if (block.type === 'button-group') {
          const updatedButtons = block.props.buttons.map((button: any) => {
            if (button.toggleStates && button.id === response.buttonId) {
              buttonToggled = true;
              return { ...button, state: button.state === 'on' ? 'off' : 'on' };
            }
            return button;
          });
          return { ...block, props: { ...block.props, buttons: updatedButtons } };
        }
        return block;
      });

      if (buttonToggled) {
        updatedBlocks = newBlocks;
        write(messageId).set('blocks', newBlocks);
      }
    }

    return {
      messageId,
      responseTimestamp: now,
      updatedAt: now,
      ...(updatedBlocks && { blocks: updatedBlocks })
    };
  },

  updateMessageState: (params: {
    messageId: EARS.EntityId;
    updates: Partial<Pick<MessageEntity, 'text' | 'blocks' | 'blockResponse' | 'responseTimestamp' | 'forkable' | 'status' | 'context' | 'compacted'>>;
  }): {
    messageId: EARS.EntityId;
    updatedAt: number;
    updates: typeof params.updates;
  } => {
    const { messageId, updates } = params;

    const message = query.ids(messageId).first();
    if (!message) {
      throw new RepositoryError(`Message ${messageId} not found`, RepositoryErrorCode.NOT_FOUND);
    }

    const now = Date.now();
    write(messageId).setMany(updates);

    // When a message becomes queued, move it to the end of its thread's
    // CONTAINS relation so it always appears last — even after a reload.
    if (updates.status === 'queued') {
      const threadLinks = query.ids(messageId).outEdges(EARS.RelKind.CONTAINS, EARS.Entity.Thread);
      for (const { target: tid } of threadLinks) {
        relinkMessageToEnd(tid, messageId);
      }
    }

    return { messageId, updatedAt: now, updates };
  },

  createMarkerMessage: (params: {
    threadId: EARS.EntityId;
    text: string;
  }): {
    id: EARS.EntityId;
    threadId: EARS.EntityId;
    text: string;
    sender: string;
    timestamp: number;
    compactedMessageIds: EARS.EntityId[];
  } => {
    const { threadId, text } = params;

    const thread = query.ids(threadId).first();
    if (!thread) {
      throw new RepositoryError(`Thread ${threadId} not found`, RepositoryErrorCode.NOT_FOUND);
    }

    // Collect eligible messages: exclude markers and already-compacted messages
    const allMessages = threadQueries.messages(threadId);
    const eligible = allMessages.filter(
      m => m.sender !== 'marker' && !m.compacted && m.id
    );

    const timestamp = Date.now();
    const markerTx = create(EARS.Entity.Message, { text: text.trim(), timestamp, sender: 'marker', createdAt: timestamp });

    const markerId = markerTx.link(EARS.RelKind.CONTAINS, threadId).id();
    write(threadId).link(EARS.RelKind.CONTAINS, markerId);
    write(threadId).set('lastMessageTimestamp', timestamp);
    relinkQueuedToEnd(threadId);

    // Link marker to eligible messages and set compacted flag
    const compactedMessageIds: EARS.EntityId[] = [];
    for (const msg of eligible) {
      const msgId = (msg as any).id as EARS.EntityId;
      write(markerId).link(EARS.RelKind.COMPACTS, msgId);
      write(msgId).set('compacted', true);
      compactedMessageIds.push(msgId);
    }

    return { id: markerId, threadId, text: text.trim(), sender: 'marker', timestamp, compactedMessageIds };
  },

  toggleMarkerCompacted: (markerId: EARS.EntityId, compacted: boolean): EARS.EntityId[] => {
    const marker = query.ids(markerId).first();
    if (!marker) {
      throw new RepositoryError(`Marker ${markerId} not found`, RepositoryErrorCode.NOT_FOUND);
    }

    const messageIds = (query.ids(markerId)
      .out(EARS.RelKind.COMPACTS, EARS.Entity.Message)
      .pick([] as const) ?? []).map(m => m.id);

    for (const msgId of messageIds) {
      write(msgId).set('compacted', compacted);
    }

    return messageIds;
  },

  copyMessagesUpTo: (params: {
    sourceThreadId: EARS.EntityId;
    targetThreadId: EARS.EntityId;
    upToMessageId: string;
  }): void => {
    const { sourceThreadId, targetThreadId, upToMessageId } = params;
    const sourceData = chatQueries.threadData(sourceThreadId);
    if (!sourceData) return;
    const sourceMessages = sourceData.messages || [];

    const copyableKeys = ['blocks', 'forkable', 'references', 'isCommand', 'command', 'autoHide', 'asUser', 'asideText', 'asideContext', 'blockResponse', 'responseTimestamp', 'status', 'context', 'compacted'] as const;

    let found = false;

    for (const msg of sourceMessages) {
      const optional: Record<string, any> = {};
      // A null is no value of these fields' shapes: a row older code wrote with one is copied without it
      for (const key of copyableKeys) {
        if (msg[key] != null) optional[key] = msg[key];
      }

      chatCommands.addMessage({
        threadId: targetThreadId,
        text: msg.text || '',
        sender: (msg.sender as 'user' | 'assistant' | 'system') || 'user',
        ...optional,
      });

      if (msg.id === upToMessageId) {
        found = true;
        break;
      }
    }

    if (!found) {
      chatCommands.addMessage({
        threadId: targetThreadId,
        text: 'Warning: fork point not found — all messages were copied.',
        sender: 'system',
      });
    }
  },

  softDeleteMessagesAfter: (params: {
    threadId: EARS.EntityId;
    messageId: EARS.EntityId;
  }): { deletedCount: number; deletedIds: string[] } => {
    const { threadId, messageId } = params;

    // A link reaches no message already in the trash
    const nonDeleted = query.ids(threadId)
      .out(EARS.RelKind.CONTAINS, EARS.Entity.Message).pick(["id"] as const) ?? [];
    const targetIndex = nonDeleted.findIndex(m => m.id === messageId);

    if (targetIndex === -1) {
      throw new RepositoryError(`Message ${messageId} not found in thread ${threadId}`, RepositoryErrorCode.NOT_FOUND);
    }

    // Delete the target message AND everything after it — the user is
    // "undoing" their message. The message text is prefilled into the chat
    // input so they can re-send or edit it.
    const toDelete = nonDeleted.slice(targetIndex).flatMap((msg) => msg.id ? [msg.id as EARS.EntityId] : []);
    for (const messageId of toDelete) write(messageId).trash();
    const deletedIds: string[] = toDelete;

    return { deletedCount: deletedIds.length, deletedIds };
  },

  createArtifact: (params: {
    artifactType: ArtifactType;
    title: string;
    content: any;
    threadId?: EARS.EntityId;
    color?: string;
  }): { artifactId: EARS.EntityId } => {
    const { artifactType, title, content, threadId, color } = params;

    const txn = create(EARS.Entity.Artifact, { title, artifactType, content });
    if (color) txn.set('color', color);
    const artifactId = txn.id();

    if (threadId) {
      write(threadId).link(EARS.RelKind.HAS, artifactId);
      write(artifactId).link(EARS.RelKind.RELATES_TO, threadId);
    }

    return { artifactId };
  },

  /**
   * Patch an existing artifact's title and/or content in place.
   *
   * Used by `services.artifact.updateAndNotify` for artifacts that need to
   * mutate across turns (e.g. the Claude Code session card, which tracks
   * live status / cost / turn count).
   */
  updateArtifact: (
    artifactId: EARS.EntityId,
    patch: { title?: string; content?: unknown },
  ): void => {
    const txn = write(artifactId);
    if (patch.title !== undefined) txn.set('title', patch.title);
    if (patch.content !== undefined) txn.set('content', patch.content);
    txn.id();
  },

  /**
   * Find an artifact by (thread, artifactType). Used by upsert helpers to
   * avoid creating duplicates on repeated turns. Returns the first match
   * (there should only ever be one for singleton types like claude-session).
   */
  findArtifactByType: (
    threadId: EARS.EntityId,
    artifactType: ArtifactType,
  ): ArtifactEntity | undefined => findArtifactByThreadAndType(threadId, artifactType),
} as const;

