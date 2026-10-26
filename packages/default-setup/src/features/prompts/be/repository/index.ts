import { promptRepository } from '@apackdev/sdk/repositories';
import type { PromptEntity } from '@apackdev/sdk';

/**
 * Prompts Repository: the SDK's prompt repository (`promptRepository`), which owns their reads and writes, as the
 * prompts surface uses it, and what its views read. The SDK's methods are taken as they are, not wrapped.
 */

// Queries
export const promptQueries = {
  byId: promptRepository.byId,
  all: promptRepository.all,
  byLabel: promptRepository.byLabel,

  /**
   * The first `limit` prompts in `categories` (every category when it's empty), or all of them without a limit, and
   * how many there are. A prompt without a category is in none, so a filter leaves it out.
   */
  list: (limit: number | null, categories: readonly string[]): { prompts: PromptEntity[]; totalCount: number } => {
    const wanted = new Set(categories);
    const matching = wanted.size === 0 ? promptQueries.all() : promptQueries.all().filter((p) => p.category !== undefined && wanted.has(p.category));
    return { prompts: limit === null ? matching : matching.slice(0, limit), totalCount: matching.length };
  },
};

// Commands
export const promptCommands = {
  create: promptRepository.create,
  update: promptRepository.update,
  /** Marks the prompt deleted */
  delete: promptRepository.delete,
};
