import { createEarsEngine, type EarsDatabase, type EarsEngine } from '@apackdev/ears';
import { createTemporaryDatabases } from '@apackdev/ears/lmdb';
import { _RUN_HISTORY_SCHEMA } from '../services/run-history.ts';

/** The process's test run histories, each removed when the process exits */
const databases = createTemporaryDatabases();

/**
 * @internal A run history's database in a temporary directory of its own, held to the run history's schema as the
 * app's is, and the engine over it: the test runtime's, and a spec's
 */
export function _openTestRunHistory(): { database: EarsDatabase; engine: EarsEngine } {
  const { database } = databases.open(_RUN_HISTORY_SCHEMA);
  return { database, engine: createEarsEngine({ database }) };
}
