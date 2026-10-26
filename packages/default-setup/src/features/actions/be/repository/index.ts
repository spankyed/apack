import { actionRepository } from '@apackdev/sdk/repositories';
import type { ActionEntity } from '@apackdev/sdk';

/**
 * Action Repository: the SDK's action repository (`actionRepository`), which owns their reads and writes, as the
 * actions surface uses it, and what its views read. The SDK's methods are taken as they are, not wrapped.
 */

// Queries
export const actionQueries = {
  byId: actionRepository.byId,
  all: actionRepository.all,
  byLabel: actionRepository.byLabel,

  /**
   * The first `limit` actions in `categories` (every category when it's empty), or all of them without a limit, and
   * how many there are. An action without a category is in none, so a filter leaves it out.
   */
  list: (limit: number | null, categories: readonly string[]): { actions: ActionEntity[]; totalCount: number } => {
    const wanted = new Set(categories);
    const matching = wanted.size === 0 ? actionQueries.all() : actionQueries.all().filter((a) => a.category !== undefined && wanted.has(a.category));
    return { actions: limit === null ? matching : matching.slice(0, limit), totalCount: matching.length };
  },
} as const;

// Commands
export const actionCommands = {
  create: actionRepository.create,
  update: actionRepository.update,
  /** Marks the action deleted */
  delete: actionRepository.delete,
} as const;
