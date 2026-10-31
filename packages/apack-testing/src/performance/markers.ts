import { existsSync, renameSync, rmSync, writeFileSync } from 'node:fs';

/** One owner publishes each handshake; readers can only see its completed JSON. */
export function publishPerformanceMarker(file: string, value: unknown) {
  const temporary = `${file}.tmp`;
  writeFileSync(temporary, JSON.stringify(value), { flag: 'wx' });
  try {
    if (existsSync(file)) throw Error('Performance marker was already published');
    renameSync(temporary, file);
  } finally { rmSync(temporary, { force: true }); }
}
