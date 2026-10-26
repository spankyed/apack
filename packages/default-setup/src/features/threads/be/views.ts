// The threads views: what the feature stores, each run again after every commit that changes its result and sent to
// the window that asked. The chat and the detail page list their messages by id, and each message is its own view, so
// a reply streaming into one message re-runs that message's view and nothing else: no list here reads a message's
// content.
import { defineViews } from '@apackdev/sdk/framework';
import { repository } from '#generated/repository.ts';
import type { EARS } from '#generated/ears.ts';
import type { RecentThreadsSortOrder } from './repository/index.ts';

export const threadViews = defineViews({
  /** The threads the list and the board show: every one not archived, newest first */
  list: () => repository.threadQueries.listed(),
  /** The archived threads, in the order the recent threads are sorted */
  archived: ({ sortOrder }: { sortOrder: RecentThreadsSortOrder }) => repository.threadQueries.archivedThreads(sortOrder),
  /** The threads the chat's sidebar lists: at most `limit`, in `sortOrder` */
  recent: ({ limit, sortOrder }: { limit: number; sortOrder: RecentThreadsSortOrder }) =>
    repository.chatQueries.recentThreads(limit, sortOrder),
  /** A thread as its detail page shows it, `null` once it is gone */
  detail: ({ id }: { id: string }) => repository.threadQueries.detail(id as EARS.EntityId),
  /** A thread as the chat shows it, with the ids of its last `limit` messages and its queued ones; `null` once gone */
  chat: ({ threadId, limit }: { threadId: string; limit: number }) =>
    repository.chatQueries.chatPage(threadId as EARS.EntityId, limit),
  /** One message, whole; `null` once it is gone */
  message: ({ id }: { id: string }) => repository.chatQueries.messageById(id as EARS.EntityId),
  /** The messages the panel's search box matches, most relevant first and newer before older, each with its thread */
  messageSearch: ({ query }: { query: string }) => repository.chatQueries.searchMessages(query),
  /** An open tab's thread: its label, whether it is pinned, and its artifacts; `null` once it is gone */
  tab: ({ threadId }: { threadId: string }) => repository.chatQueries.tab(threadId as EARS.EntityId),
});
