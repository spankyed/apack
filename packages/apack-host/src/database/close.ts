// App shutdown retains write exclusion until background workers exit and each handle closes.
import type { EarsDatabase } from '@apackdev/ears';

export async function closeDatabases(databases: Iterable<EarsDatabase | undefined>): Promise<void> {
  const results = await Promise.allSettled([...new Set(databases)].filter((database): database is EarsDatabase => database !== undefined && database.isOpen)
    .map(async database => database.withExclusiveWrites(async () => {
      await database.drainBackground?.();
      database.close();
    })));
  const errors = results.flatMap(result => result.status === 'rejected' ? [result.reason] : []);
  if (errors.length) throw new AggregateError(errors, 'Database shutdown failed; background work may not have drained');
}
