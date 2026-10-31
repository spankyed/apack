import { expect, it, vi } from 'vitest';
import { withDatabase } from '../../src/commands/db/target';

it.each([undefined, null, false, 0, ''])('rejects a thrown %s from a database command and still closes it', async failure => {
  const close = vi.fn(); let rejected = false;
  await withDatabase({ close }, () => { throw failure; }).then(
    () => undefined,
    error => { rejected = true; expect(error).toBe(failure); },
  );
  expect(rejected).toBe(true);
  expect(close).toHaveBeenCalledTimes(1);
});

it.each(['COMMIT_UNKNOWN', 'PUBLICATION_UNKNOWN', 'NOT_DURABLE'])('preserves a database command %s when close also fails', async code => {
  const primary = Object.assign(new Error('operation failed'), {
    code, recoveryPath: '/retained/incumbent', destinationPath: '/backup', publishedPath: '/published', dataInstalled: false,
  });
  const cleanup = new Error('close failed'), close = vi.fn(() => { throw cleanup; });
  await expect(withDatabase({ close }, () => { throw primary; })).rejects.toMatchObject({
    code, cause: primary, errors: [primary, cleanup],
    recoveryPath: primary.recoveryPath, destinationPath: primary.destinationPath, publishedPath: primary.publishedPath, dataInstalled: false,
  });
  expect(close).toHaveBeenCalledTimes(1);
});

it('preserves a thrown undefined alongside a database close failure', async () => {
  const cleanup = new Error('close failed');
  await expect(withDatabase({ close() { throw cleanup; } }, () => { throw undefined; })).rejects.toMatchObject({
    errors: [undefined, cleanup],
  });
});
