import { featureSettings } from '#generated/settings.ts';

import { create, write, query, transact } from '#generated/ears.ts';

import { EARS } from '#generated/ears.ts';
import { RepositoryError, RepositoryErrorCode } from '@apackdev/sdk/repositories';
import { wouldCreateCycle } from '@apackdev/sdk/ears';
import { createLogger } from '@apackdev/sdk/logger';
import type {
  ThreadEntity, MessageEntity, ArtifactEntity, BlockConfig, MessageReferences, ToolActivityEntry,
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

  /** A thread's messages, assembled — the one reader, so nothing here picks its own fields */
  messages: (threadId: EARS.EntityId) => messagesOfThread(threadId),
  
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
      discardBlocks(messageId, 'destroy');
      discardMessageText(messageId);
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

/**
 * A message's blocks, in the order its edges record.
 *
 * One relation walk per message. The chat and detail pages list message *ids* and each message is its own view,
 * so this runs for the one message that changed rather than for a page of them.
 */
function blocksOf(messageId: EARS.EntityId): BlockConfig[] {
  return childrenOfMessages([messageId]).get(messageId) ?? [];
}

/**
 * Every one of these messages' blocks, assembled, in four reads however many messages there are.
 *
 * `query.ids` and `outEdges` both take the whole set, so a thread's messages cost one edge walk, one
 * batched read of the block rows, and `childrenOf`'s own pair for every block at once. Asking per message
 * is what made reading a thread linear in its messages and then linear again in their children.
 */
function childrenOfMessages(messageIds: readonly EARS.EntityId[]): Map<EARS.EntityId, BlockConfig[]> {
  const blocks = new Map<EARS.EntityId, BlockConfig[]>();
  if (messageIds.length === 0) return blocks;

  const edges = query.ids(messageIds).outEdges(EARS.RelKind.HAS_BLOCK, EARS.Entity.Block);
  if (edges.length === 0) return blocks;

  const rows = rowsByIdOf(edges.map((edge) => edge.target), ['type', 'props'] as const);
  const parts = childrenOf(edges.map((edge) => edge.target));

  for (const edge of [...edges].sort((a, b) => indexOf(a.info) - indexOf(b.info))) {
    const row = rows.get(edge.target);
    if (!row) continue;
    const held = blocks.get(edge.source) ?? [];
    held.push({ type: row.type as string, props: assembled(parts, edge.target, (row.props ?? {}) as Record<string, any>) });
    blocks.set(edge.source, held);
  }
  return blocks;
}

/**
 * The same, each with the row it came from.
 *
 * **For a caller that may not assume one block per type.** `writeMessageBlock` resolves a block by type,
 * which is right for a streaming writer that owns the only block of its own, and wrong for anything walking
 * a message's blocks: a message may hold two of a type, and writing those back by type would put the second
 * one's content on the first one's row.
 */
function blockRowsOf(messageId: EARS.EntityId): Array<{ id: EARS.EntityId; type: string; props: Record<string, any> }> {
  const edges = query.ids(messageId).outEdges(EARS.RelKind.HAS_BLOCK, EARS.Entity.Block);
  // **Most messages have no blocks at all**, and a message's read is the hot path — every message in an
  // opened thread runs it — so one that has none asks nothing further
  if (edges.length === 0) return [];

  const rows = rowsByIdOf(edges.map((edge) => edge.target), ['type', 'props'] as const);
  const parts = childrenOf(edges.map((edge) => edge.target));

  return edges
    .filter((edge) => rows.has(edge.target))
    .sort((a, b) => indexOf(a.info) - indexOf(b.info))
    .map((edge) => {
      const row = rows.get(edge.target)!;
      return {
        id: edge.target,
        type: row.type as string,
        props: assembled(parts, edge.target, (row.props ?? {}) as Record<string, any>),
      };
    });
}

/**
 * Rows by id, in one read of the engine rather than one per id.
 *
 * **`query.ids` takes the whole list**, which is the difference between a message's read costing what it
 * holds and costing a constant. Asking per id made reading a message with forty tool entries 45 crossings
 * where it is now the same handful as a message with none (`tests/features/threads/be/query-work.spec.ts`).
 */
function rowsByIdOf<const F extends readonly string[]>(ids: readonly EARS.EntityId[], fields: F): Map<EARS.EntityId, Record<string, any>> {
  if (ids.length === 0) return new Map();
  const rows = query.ids(ids).pick(fields as never) as unknown as Array<Record<string, any>> | null;
  return new Map((rows ?? []).map((row) => [row.id as EARS.EntityId, row]));
}

/**
 * How many segments a block carries before its text is folded back into it.
 *
 * **Not for the crossings, which are constant.** A read of a message costs two edge walks and two row
 * reads whatever its blocks hold (`childrenOf`), so segments cost it nothing in reads of the engine — an
 * earlier version of this comment justified the fold by a quadratic that the batching removed. What it
 * bounds is what a read *assembles*: a view re-runs on every append, so without a fold a three-minute turn
 * concatenates ninety segments ninety times. Folding at a count bounds that, and bounds the rows a turn
 * holds open, at one whole-text write per fold.
 *
 * At 32, a turn of ninety appends writes about 2.4x its text and no read of it assembles more than 32
 * segments. The figure is a balance rather than a measurement, so it needs no record of conditions; what
 * it must not become is a per-caller knob, which would make what a block costs depend on who wrote it.
 *
 * **The entries have no equivalent, and that is a decision rather than an omission.** A segment is a few
 * hundred characters of text that accretes, so folding thirty of them is a small write. An entry carries
 * `details.output`, the untruncated tool result, and arrives whole — so folding entries mid-turn would
 * write every output again, which is the amplification the rows removed. They fold once, when the block
 * stops growing (`compactMessageBlock`).
 */
const TEXT_SEGMENTS_BEFORE_COMPACTION = 32;

/**
 * Every block's growing children, read for all of them at once.
 *
 * **Four reads for a message however many blocks it has and however much they hold** — two edge walks and
 * two row reads — because `query.ids` and `outEdges` both take the whole set. Per block and per child it
 * was one read each, which put a message's cost on the hot path at what its turn happened to produce.
 */
interface BlockChildren {
  readonly segments: Map<EARS.EntityId, Array<{ id: EARS.EntityId; at: number; text: string }>>;
  readonly entries: Map<EARS.EntityId, Array<{ id: EARS.EntityId; entry: ToolActivityEntry }>>;
}

/**
 * What an entry contributes to its block's props: the fields the collapsed row draws, and **not** `details`.
 *
 * `details.output` is the whole tool result — a `Read` of a large file is that file — and it is revealed on
 * hover, inside a block the user has opened. Carried in the props it was read on every re-run of the
 * message's view, which re-runs on every append while a turn streams, so a window paid for every tool's
 * full output to draw rows showing a 120-character summary of each. That is a different axis from the
 * crossings this file's neighbour bounded: one read, and all of it.
 *
 * `entryDetails` serves them instead, to the window that has the block open. EARS holds one value per
 * attribute and `pick` reads the ones it names, so leaving `details` out of this list is what stops it
 * being read — and `BLOCK_DETAILS` is where it goes once the entry rows are folded away.
 */
const TOOL_ENTRY_FIELDS = ['entryId', 'tool', 'summary', 'status', 'durationMs', 'outputSummary'] as const;

/**
 * The attribute a compacted block keeps its entries' details under, by entry id.
 *
 * **A separate attribute rather than a field of `props`**, which is what lets a finished block stay one row
 * without putting the turn's whole output back into every read of it: a message's read picks `type` and
 * `props`, so this is not loaded, and the hover's own read names it alone.
 */
const BLOCK_DETAILS = 'entryDetails';

function childrenOf(blockIds: readonly EARS.EntityId[]): BlockChildren {
  const segments = new Map<EARS.EntityId, Array<{ id: EARS.EntityId; at: number; text: string }>>();
  const entries = new Map<EARS.EntityId, Array<{ id: EARS.EntityId; entry: ToolActivityEntry }>>();
  if (blockIds.length === 0) return { segments, entries };

  const textEdges = query.ids(blockIds).outEdges(EARS.RelKind.HAS_TEXT, EARS.Entity.BlockText);
  const entryEdges = query.ids(blockIds).outEdges(EARS.RelKind.HAS_ENTRY, EARS.Entity.ToolEntry);

  const textRows = rowsByIdOf(textEdges.map((edge) => edge.target), ['at', 'text'] as const);
  const entryRows = rowsByIdOf(entryEdges.map((edge) => edge.target), TOOL_ENTRY_FIELDS);

  for (const edge of textEdges) {
    const row = textRows.get(edge.target);
    if (!row) continue;
    const held = segments.get(edge.source) ?? [];
    held.push({ id: edge.target, at: row.at as number, text: row.text as string });
    segments.set(edge.source, held);
  }
  for (const edge of entryEdges) {
    const row = entryRows.get(edge.target);
    if (!row) continue;
    const held = entries.get(edge.source) ?? [];
    held.push({ id: edge.target, entry: toolEntryOf(row), index: indexOf(edge.info) } as never);
    entries.set(edge.source, held);
  }

  for (const held of segments.values()) held.sort((a, b) => a.at - b.at);
  for (const held of entries.values()) {
    held.sort((a, b) => ((a as never as { index: number }).index) - ((b as never as { index: number }).index));
  }
  return { segments, entries };
}

/**
 * A block's stored props with its children folded in: text segments spliced onto the compacted prefix, and
 * entry rows as the list its component draws.
 *
 * **A block's growing parts are children, and they assemble into the two prop names the components read.**
 * Naming `content` and `entries` here is the contract rather than a leak: there are two kinds of growing
 * part and they are genuinely different — text spliced by offset, entries ordered by their edge — so a
 * generic part mechanism invented for two cases would be machinery standing in for a decision.
 */
function assembled(parts: BlockChildren, blockId: EARS.EntityId, props: Record<string, any>): Record<string, any> {
  let held = props;

  const segments = parts.segments.get(blockId) ?? [];
  if (segments.length > 0) {
    const content = segments.reduce(
      (text, segment) => text.slice(0, segment.at) + segment.text,
      typeof held.content === 'string' ? held.content : '',
    );
    held = { ...held, content };
  }

  const entries = parts.entries.get(blockId) ?? [];
  // `blockId` beside them because the entries no longer carry their `details`: it is what the component
  // names to ask for them (`entryDetails`), and only a block with entries has anything to ask about
  if (entries.length > 0) held = { ...held, entries: entries.map(({ entry }) => entry), blockId };

  return held;
}

/** An entry as its block's props carry it: the stored row under the `id` its component and the CLI use */
const toolEntryOf = (row: Record<string, unknown>): ToolActivityEntry => {
  const { entryId, ...rest } = row as { entryId: string } & Record<string, unknown>;
  return { ...rest, id: entryId } as unknown as ToolActivityEntry;
};

/** One block's text segments in offset order, each with its row */
const segmentsOf = (blockId: EARS.EntityId) => childrenOf([blockId]).segments.get(blockId) ?? [];

/** One block's tool entries in edge order, each with its row */
const entriesOf = (blockId: EARS.EntityId) => childrenOf([blockId]).entries.get(blockId) ?? [];

/** Folds a block's segments into its own text and removes them; the block then reads as it always did */
function compactBlockText(blockId: EARS.EntityId): void {
  const parts = childrenOf([blockId]);
  if ((parts.segments.get(blockId) ?? []).length === 0) return;
  const props = (query.ids(blockId).pickOne(['props'] as const)?.props ?? {}) as Record<string, any>;
  write(blockId).set('props', assembled(parts, blockId, props));
  const segments = parts.segments.get(blockId) ?? [];
  for (const segment of segments) {
    write(blockId).unlink(EARS.RelKind.HAS_TEXT, segment.id);
    write(segment.id).destroy();
  }
}

/**
 * The full details of a block's tool entries, by the entry id its component draws them under.
 *
 * **Both places they can be**, because a block is compacted when its writer finishes: the live entry rows
 * while a turn runs, and `BLOCK_DETAILS` on the block itself once those rows have been folded away. A read
 * that knew only the rows would answer nothing for every finished turn, which is most of a thread.
 */
function entryDetailsOf(blockId: EARS.EntityId): Record<string, ToolActivityEntry['details']> {
  const folded = (query.ids(blockId).pickOne([BLOCK_DETAILS] as const)?.[BLOCK_DETAILS] ?? {}) as Record<string, ToolActivityEntry['details']>;
  const live = rowsByIdOf(
    query.ids(blockId).outEdges(EARS.RelKind.HAS_ENTRY, EARS.Entity.ToolEntry).map((edge) => edge.target),
    ['entryId', 'details'] as const,
  );
  const held: Record<string, ToolActivityEntry['details']> = { ...folded };
  for (const row of live.values()) {
    if (row.entryId !== undefined) held[row.entryId as string] = row.details as ToolActivityEntry['details'];
  }
  return held;
}

/** The message's block of that type, or absence; the type is what a streaming writer owns one by */

/** The position an edge records; an edge written before one was recorded sorts last rather than first */
const indexOf = (info: unknown): number =>
  typeof info === 'object' && info !== null && typeof (info as { index?: unknown }).index === 'number'
    ? (info as { index: number }).index
    : Number.MAX_SAFE_INTEGER;

/** Creates a message's blocks as rows, each edge recording its position */
function createBlocks(messageId: EARS.EntityId, blocks: readonly BlockConfig[]): void {
  blocks.forEach((block, index) => {
    const blockId = create(EARS.Entity.Block, { type: block.type, props: block.props }).id();
    write(messageId).link(EARS.RelKind.HAS_BLOCK, blockId, { info: { index } });
  });
}

/**
 * Discards a message's blocks the way the message itself is being discarded.
 *
 * **EARS cascades nothing, so an owner's children are the owner's to discard** — the shape `flowRepository`'s
 * `deleteFlow` uses for its nodes and `collectionRepository` for a folder's children. Without this a deleted
 * message leaves rows no message reaches. `trash()` is the soft one reads skip, `destroy()` the hard one, and
 * which a block gets is whichever its message got.
 */
/**
 * A message's text segments go outright with it, whichever way it goes.
 *
 * They are a turn's working state and never the user's, as a block's are — and a trashed message reads
 * through `assembledMessage`, which would otherwise splice rows nothing reaches.
 */
function discardMessageText(messageId: EARS.EntityId): void {
  for (const segment of textOf([messageId]).get(messageId) ?? []) {
    write(messageId).unlink(EARS.RelKind.HAS_MESSAGE_TEXT, segment.id);
    write(segment.id).destroy();
  }
}

function discardBlocks(messageId: EARS.EntityId, how: 'trash' | 'destroy'): void {
  for (const edge of query.ids(messageId).outEdges(EARS.RelKind.HAS_BLOCK, EARS.Entity.Block)) {
    // A segment is a block's working state and is never the user's, so it goes outright either way: a
    // trashed block reads through `assembled`, which would otherwise assemble rows nothing reaches
    for (const segment of segmentsOf(edge.target)) {
      write(edge.target).unlink(EARS.RelKind.HAS_TEXT, segment.id);
      write(segment.id).destroy();
    }
    for (const entry of entriesOf(edge.target)) {
      write(edge.target).unlink(EARS.RelKind.HAS_ENTRY, entry.id);
      write(entry.id).destroy();
    }
    if (how === 'trash') write(edge.target).trash();
    else write(edge.target).destroy();
  }
}

function blockIdOfType(messageId: EARS.EntityId, type: string): EARS.EntityId | undefined {
  return query.ids(messageId).outEdges(EARS.RelKind.HAS_BLOCK, EARS.Entity.Block)
    .map((edge) => edge.target)
    .find((id) => query.ids(id).pickOne(['type'] as const)?.type === type);
}

/**
 * **Every field a message is read with, and the one list there is.**
 *
 * There were four — this one, `threadQueries.messages`', `export-threads`' own, and `messageById`'s — and
 * nothing said which was authoritative. Each had drifted: the export's lacked `context` and `compacted`,
 * `threadQueries.messages`' lacked `id`. A reader that wants fewer fields still costs the same read, since
 * a `pick` reads the row either way, so there was nothing to buy by differing.
 *
 * It matters more now that a message is assembled rather than read: `text` and `blocks` come from child
 * rows, so a caller that picks its own fields gets a row with neither, and **truncated text does not
 * crash** — it reaches a title, a recap, a transcript or a fork copy as if it were whole. One list and one
 * reader is what makes that impossible rather than caught.
 */
const messagePickFields = ["id", "text", "sender", "timestamp", "blockResponse", "responseTimestamp", "createdAt", "updatedAt", "forkable", "references", "isCommand", "command", "context", "autoHide", "asUser", "asideText", "asideContext", "status", "compacted"] as const;

/** One message, assembled: its row's fields with its children folded in */
function messageOf(messageId: EARS.EntityId): MessageEntity | null {
  const row = query.ids(messageId).pickOne(messagePickFields);
  if (!row) return null;
  return assembledMessage(row as Partial<MessageEntity>, blocksOf(messageId), textOf([messageId]).get(messageId) ?? []);
}

/** A row's fields with its children folded in: the blocks it holds and the text appended since its prefix */
function assembledMessage(
  row: Partial<MessageEntity>,
  blocks: BlockConfig[],
  segments: ReadonlyArray<{ id: EARS.EntityId; at: number; text: string }>,
): MessageEntity {
  const text = segments.reduce(
    (held, segment) => held.slice(0, segment.at) + segment.text,
    typeof row.text === 'string' ? row.text : '',
  );
  return {
    ...row,
    entityType: EARS.Entity.Message,
    ...(segments.length > 0 && { text }),
    ...(blocks.length > 0 && { blocks }),
  } as MessageEntity;
}

/** These messages' text segments in offset order, in two reads however many messages there are */
function textOf(messageIds: readonly EARS.EntityId[]): Map<EARS.EntityId, Array<{ id: EARS.EntityId; at: number; text: string }>> {
  const held = new Map<EARS.EntityId, Array<{ id: EARS.EntityId; at: number; text: string }>>();
  if (messageIds.length === 0) return held;

  const edges = query.ids(messageIds).outEdges(EARS.RelKind.HAS_MESSAGE_TEXT, EARS.Entity.MessageText);
  if (edges.length === 0) return held;

  const rows = rowsByIdOf(edges.map((edge) => edge.target), ['at', 'text'] as const);
  for (const edge of edges) {
    const row = rows.get(edge.target);
    if (!row) continue;
    const mine = held.get(edge.source) ?? [];
    mine.push({ id: edge.target, at: row.at as number, text: row.text as string });
    held.set(edge.source, mine);
  }
  for (const mine of held.values()) mine.sort((a, b) => a.at - b.at);
  return held;
}

/**
 * A thread's messages, assembled, in the order the chat shows them: queued last.
 *
 * One relation walk and one batched read of the rows, then the children for all of them at once — so a
 * thread of a hundred messages costs a constant number of crossings rather than one read per message
 * (`tests/features/threads/be/query-work.spec.ts`).
 */
function messagesOfThread(threadId: EARS.EntityId): MessageEntity[] {
  const rows = (query.ids(threadId).out(EARS.RelKind.CONTAINS, EARS.Entity.Message).pick(messagePickFields) ?? []) as Partial<MessageEntity>[];
  const ids = rows.flatMap((row) => (row.id ? [row.id as EARS.EntityId] : []));
  const children = childrenOfMessages(ids);
  const text = textOf(ids);
  return rows
    .map((row) => assembledMessage(
      row,
      children.get(row.id as EARS.EntityId) ?? [],
      text.get(row.id as EARS.EntityId) ?? [],
    ))
    .sort((a, b) => {
      if (a.status === 'queued' && b.status !== 'queued') return 1;
      if (b.status === 'queued' && a.status !== 'queued') return -1;
      return 0;
    });
}

function getThreadFields(threadId: EARS.EntityId): AgentThreadData | null {
  const thread = query.ids(threadId)
    .orderBy('timestamp', 'desc')
    .limit(4)
    .pick(["shortCode", "topic", "instructions", "status", "timestamp", "forcedMode", "pinned", "chatState", "context"] as const);
  return thread[0] as AgentThreadData | null;
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
      messages: messagesOfThread(threadId),
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

  /** A message's blocks, assembled from their rows: what an export carries and `messageById` folds in */
  blocksOf: (messageId: EARS.EntityId): BlockConfig[] => blocksOf(messageId),
  entryDetails: (blockId: EARS.EntityId): Record<string, ToolActivityEntry['details']> => entryDetailsOf(blockId),

  /** One message, whole; `null` once it is gone */
  messageById: (messageId: EARS.EntityId): MessageEntity | null => messageOf(messageId)
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

    if (blocks) createBlocks(messageId, blocks);

    write(threadId).link(EARS.RelKind.CONTAINS, messageId);
    write(threadId).set('lastMessageTimestamp', timestamp);

    // Keep queued messages at the end of the relation list so they always render below the current agent turn, even
    // after a thread reload; a bulk add skips it for each message and moves them once after its last
    if (!skipRelink) relinkQueuedToEnd(threadId, messageId);

    return { id: messageId, threadId, text: text.trim(), sender, timestamp };
  },

  /** Creates a message's blocks as rows, in the order given: what a message's creation and an import write */
  writeMessageBlocks: (params: { messageId: EARS.EntityId; blocks: readonly BlockConfig[] }): void => {
    createBlocks(params.messageId, params.blocks);
  },

  /**
   * Appends the next characters of a block's text, and answers nothing it did not write.
   *
   * **The store's half of what the feed sends.** A growing block's text used to be written whole on every
   * durable flush, so what reached storage grew with the turn; a segment is written once. The block's own
   * text is the compacted prefix and this is what follows it, so a reader splices by offset exactly as a
   * window does.
   *
   * It folds the segments back in once there are `TEXT_SEGMENTS_BEFORE_COMPACTION` of them, which is what
   * keeps a read of a long turn bounded. A caller never asks for that and cannot skip it.
   */
  appendMessageBlockText: (params: { blockId: EARS.EntityId; at: number; text: string }): void => {
    const { blockId, at, text } = params;
    if (!text) return;
    if (!query.ids(blockId).ofType(EARS.Entity.Block).first()) {
      throw new RepositoryError(`Block ${blockId} not found`, RepositoryErrorCode.NOT_FOUND);
    }

    const segment = create(EARS.Entity.BlockText, { at, text }).id();
    write(blockId).link(EARS.RelKind.HAS_TEXT, segment);

    if (segmentsOf(blockId).length >= TEXT_SEGMENTS_BEFORE_COMPACTION) compactBlockText(blockId);
  },

  /**
   * Appends the next characters of a message's own text.
   *
   * **The same shape as a block's text, for the last field that was written whole.** `Message.text` keeps
   * the compacted prefix and this is what follows it, spliced by offset exactly as a window splices the
   * feed.
   *
   * It folds at `TEXT_SEGMENTS_BEFORE_COMPACTION`, and that fold is not an optimisation — it is what keeps
   * the text searchable. `Message.text` is what the text index reads, so a tail living in segments is a
   * tail no search finds, and a turn can end without its writer being finalised. The size trigger bounds
   * that to one fold's worth; `foldMessageText` is the rest of the answer.
   */
  appendMessageText: (params: { messageId: EARS.EntityId; at: number; text: string }): void => {
    const { messageId, at, text } = params;
    if (!text) return;
    if (!query.ids(messageId).ofType(EARS.Entity.Message).first()) {
      throw new RepositoryError(`Message ${messageId} not found`, RepositoryErrorCode.NOT_FOUND);
    }

    const segment = create(EARS.Entity.MessageText, { at, text }).id();
    write(messageId).link(EARS.RelKind.HAS_MESSAGE_TEXT, segment);

    if ((textOf([messageId]).get(messageId) ?? []).length >= TEXT_SEGMENTS_BEFORE_COMPACTION) {
      chatCommands.foldMessageText({ messageId });
    }
  },

  /**
   * Folds a message's text segments into its own field and removes them.
   *
   * **What makes the text searchable again**, so it is called when a turn's writer finalises and by the
   * sweep at boot for a turn that ended without one.
   */
  foldMessageText: (params: { messageId: EARS.EntityId }): void => {
    const { messageId } = params;
    const segments = textOf([messageId]).get(messageId) ?? [];
    if (segments.length === 0) return;

    const row = query.ids(messageId).pickOne(['text'] as const);
    const text = segments.reduce(
      (held, segment) => held.slice(0, segment.at) + segment.text,
      typeof row?.text === 'string' ? row.text : '',
    );
    write(messageId).set('text', text);
    for (const segment of segments) {
      write(messageId).unlink(EARS.RelKind.HAS_MESSAGE_TEXT, segment.id);
      write(segment.id).destroy();
    }
  },

  /**
   * Folds every message that still holds text segments, and answers how many it folded.
   *
   * **Nothing streams at boot, so a message holding segments at boot was left unfolded** — which is the
   * marker, and why this needs no `'streaming'` status to find them by. A turn interrupted by a kill
   * finalises through its owner, and one interrupted by the process ending cannot, so this is that case's
   * repair: without it the tail stays out of the text index for good.
   */
  foldStrandedMessageText: (): number => {
    const stranded = [...new Set(
      query(EARS.Entity.MessageText).ids()
        .flatMap((segment) => query.ids(segment).inEdges(EARS.RelKind.HAS_MESSAGE_TEXT, EARS.Entity.Message))
        .map((edge) => edge.source),
    )];
    for (const messageId of stranded) chatCommands.foldMessageText({ messageId });
    return stranded.length;
  },

  /**
   * Writes one of a block's tool entries, and answers its row.
   *
   * **The same shape as `writeMessageBlock`, one level down**: pass the row id a previous write answered
   * and this is one row by id, which is what makes a tool event cost its own entry. Without one the entry
   * is found among the block's by its `entryId`, or created at the end.
   *
   * `details` merges field-wise, as the writer's own `update` does, so a patch carrying only an output
   * does not drop the input recorded when the tool started.
   */
  writeToolEntry: (params: {
    blockId: EARS.EntityId;
    entry: ToolActivityEntry;
    entryRowId?: EARS.EntityId;
  }): EARS.EntityId | undefined => {
    const { blockId, entry, entryRowId } = params;

    const held = entryRowId ?? entriesOf(blockId).find(({ entry: one }) => one.id === entry.id)?.id;
    if (held) {
      const kept = query.ids(held).pickOne(['details'] as const)?.details as ToolActivityEntry['details'];
      write(held).setMany({
        tool: entry.tool,
        summary: entry.summary,
        status: entry.status,
        ...(entry.durationMs !== undefined && { durationMs: entry.durationMs }),
        ...(entry.outputSummary !== undefined && { outputSummary: entry.outputSummary }),
        ...(entry.details !== undefined && { details: { ...kept, ...entry.details } }),
      });
      return held;
    }

    const index = query.ids(blockId).outEdges(EARS.RelKind.HAS_ENTRY, EARS.Entity.ToolEntry).length;
    const created = create(EARS.Entity.ToolEntry, {
      entryId: entry.id,
      tool: entry.tool,
      summary: entry.summary,
      status: entry.status,
      ...(entry.durationMs !== undefined && { durationMs: entry.durationMs }),
      ...(entry.outputSummary !== undefined && { outputSummary: entry.outputSummary }),
      ...(entry.details !== undefined && { details: entry.details }),
    }).id();
    write(blockId).link(EARS.RelKind.HAS_ENTRY, created, { info: { index } });
    return created;
  },

  /**
   * Folds a block's children into it and removes them: what a writer calls when the block has stopped
   * growing.
   *
   * **A finished block is one row again.** The children exist to make a *turn's* writes cheap; once it is
   * over they are only cost — a read of the message assembles them, and a thread keeps them for ever. A
   * turn of forty tools left forty rows per message behind without this.
   */
  compactMessageBlock: (params: { blockId: EARS.EntityId }): void => {
    const { blockId } = params;
    const parts = childrenOf([blockId]);
    const segments = parts.segments.get(blockId) ?? [];
    const entries = parts.entries.get(blockId) ?? [];
    if (segments.length === 0 && entries.length === 0) return;

    const props = (query.ids(blockId).pickOne(['props'] as const)?.props ?? {}) as Record<string, any>;
    write(blockId).set('props', assembled(parts, blockId, props));
    for (const segment of segments) {
      write(blockId).unlink(EARS.RelKind.HAS_TEXT, segment.id);
      write(segment.id).destroy();
    }
    // The details are folded onto the block under their own attribute, not into `props`: the rows that hold
    // them are about to go, and a read of the message must not start carrying the turn's whole output again
    if (entries.length > 0) write(blockId).set(BLOCK_DETAILS, entryDetailsOf(blockId));
    for (const entry of entries) {
      write(blockId).unlink(EARS.RelKind.HAS_ENTRY, entry.id);
      write(entry.id).destroy();
    }
  },

  /**
   * Writes one of a message's blocks, by its type, and answers its row id.
   *
   * **The hot path of a streamed turn.** A caller that holds the id from a previous write passes it and the
   * write is one row by id, with no walk: that is what makes a 250ms flush cost its own block and nothing
   * else. Without one the block of that type is found, or created at the end.
   */
  writeMessageBlock: (params: {
    messageId: EARS.EntityId;
    block: BlockConfig;
    blockId?: EARS.EntityId;
  }): EARS.EntityId => {
    const { messageId, block, blockId } = params;

    const held = blockId ?? blockIdOfType(messageId, block.type);
    if (held) {
      // The props carry the whole of what the children held, so they are already in what is being set
      for (const segment of segmentsOf(held)) {
        write(held).unlink(EARS.RelKind.HAS_TEXT, segment.id);
        write(segment.id).destroy();
      }
      if (block.props.entries !== undefined) {
        for (const entry of entriesOf(held)) {
          write(held).unlink(EARS.RelKind.HAS_ENTRY, entry.id);
          write(entry.id).destroy();
        }
      }
      write(held).setMany({ type: block.type, props: block.props });
      return held;
    }

    const index = query.ids(messageId).outEdges(EARS.RelKind.HAS_BLOCK, EARS.Entity.Block).length;
    const created = create(EARS.Entity.Block, { type: block.type, props: block.props }).id();
    write(messageId).link(EARS.RelKind.HAS_BLOCK, created, { info: { index } });
    return created;
  },

  /** Removes a message's block of that type; absence is not an error, the caller asking for it to be gone */
  removeMessageBlock: (params: { messageId: EARS.EntityId; type: string }): void => {
    const { messageId, type } = params;
    const held = blockIdOfType(messageId, type);
    if (!held) return;
    write(messageId).unlink(EARS.RelKind.HAS_BLOCK, held);
    write(held).destroy();
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
    // Assembled from the rows: `blocks` is not an attribute, and a pick naming it answered `undefined`.
    // With their ids, because a message may hold two blocks of a type and only one holds this button
    const storedRows = blockRowsOf(messageId);

    if (storedRows.length > 0 && response.buttonId) {
      const written: EARS.EntityId[] = [];
      const newRows = storedRows.map((held) => {
        if (held.type !== 'button-group') return held;
        let holdsIt = false;
        const buttons = held.props.buttons.map((button: any) => {
          if (button.toggleStates && button.id === response.buttonId) {
            holdsIt = true;
            return { ...button, state: button.state === 'on' ? 'off' : 'on' };
          }
          return button;
        });
        if (!holdsIt) return held;
        written.push(held.id);
        return { ...held, props: { ...held.props, buttons } };
      });

      if (written.length > 0) {
        updatedBlocks = newRows.map(({ type, props }) => ({ type, props }));
        // By id, and only the rows that changed: a neighbour's row is never rewritten to reach one
        for (const row of newRows.filter((held) => written.includes(held.id))) {
          chatCommands.writeMessageBlock({ messageId, block: { type: row.type, props: row.props }, blockId: row.id });
        }
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
    updates: Partial<Pick<MessageEntity, 'text' | 'blockResponse' | 'responseTimestamp' | 'forkable' | 'status' | 'context' | 'compacted'>>;
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

    // **A write of the whole text is the fold**, so the segments go with it — they hold a tail this value
    // already carries, and left behind they would splice over it. The same rule as `writeMessageBlock`'s
    // whole-block write dropping a block's own segments; asking for the fold separately wrote the text
    // twice, which is what made a streamed reply cost 2.8x where it now costs 1.84x
    if (updates.text !== undefined) discardMessageText(messageId);

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
    for (const messageId of toDelete) {
      discardBlocks(messageId, 'trash');
      discardMessageText(messageId);
      write(messageId).trash();
    }
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

