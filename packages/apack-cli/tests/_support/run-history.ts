// The run history's database for the specs that write nodes as a run left them, read them back and remove them
import type { EARS } from '@apackdev/ears';
import { openRunHistory } from '@apackdev/host/database';

/** The run history's database at `dir`, its nodes written whole, read and removed by id */
export function runHistoryAt(dir: string, options: { readOnly?: boolean } = {}) {
  const runs = openRunHistory(dir, options);
  const entity = (id: string) => id as unknown as EARS.EntityId;
  return {
    database: runs.database,
    put({ id, ...fields }: { id: string } & Record<string, unknown>) {
      runs.engine.create('RunNode', { ...fields, id: entity(id) });
    },
    get: (id: string) => runs.engine.getRow(entity(id)),
    delete: (id: string) => runs.engine.write(entity(id)).destroy(),
    close: () => runs.database.close(),
  };
}
