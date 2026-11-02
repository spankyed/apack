// App-only adapters own async maintenance authority; the pack-facing engine stays synchronous.
import { AsyncLocalStorage } from 'node:async_hooks';

const authority = new AsyncLocalStorage<ReadonlySet<object>>();
export function withoutWriteAuthority<T>(operation: () => T): T { return authority.exit(operation); }
export function createWriteLease() {
  let owner: object | undefined;
  const assertWritable = () => {
    if (owner && !authority.getStore()?.has(owner)) {
      throw Object.assign(new Error('Database maintenance is in progress; retry the write after it finishes'), { code: 'WRITE_PAUSED' });
    }
  };
  return {
    assertWritable,
    async run<T>(operation: () => Promise<T>): Promise<T> {
      assertWritable();
      if (owner) return operation();
      const token = {}; owner = token;
      try { return await authority.run(new Set([...(authority.getStore() ?? []), token]), operation); }
      finally { owner = undefined; }
    },
  };
}
