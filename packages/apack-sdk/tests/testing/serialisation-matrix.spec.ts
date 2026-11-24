// The three value-serialising passes that live in this package, each against its own row of the matrix.
//
// The matrix is data (`src/testing/serialisation-matrix.ts`) because no package can import all five passes —
// the encoder is `@app/server`'s and `toJSON` is `@apackdev/cli`'s, and each asserts its row in its own suite. What
// that buys is that a cell cannot drift from the code: `docs/references/value-serialisation.md` is the same
// answers in prose, and these are the ones that fail.
//
// The differences between the rows are deliberate and the doc says why. What this file is for is that they stay
// the differences somebody chose.
import { afterAll, describe, expect, it } from 'vitest';
import {
  _SERIALISATION_INPUTS,
  _SERIALISATION_MATRIX,
  _answer,
  type _SerialisationInput,
} from '../../src/testing/serialisation-matrix.ts';
import { redactSecrets } from '../../src/utils/redact.ts';
import { truncateResult } from '../../src/steps/index.ts';
import { createLogger, type LogEvent } from '../../src/logger/index.ts';
import { bindHost, unbindHost } from '../../src/runtime/host-runtime.ts';

/** The log events the bound bus received, which is where a logger puts its meta */
const logged: LogEvent[] = [];
bindHost({ transport: { rootEvents: { emitLog: (event: LogEvent) => { logged.push(event); } } } } as never);
afterAll(() => unbindHost());

const logger = createLogger('matrix');

/** What the logger's meta pass made of `value` — `redactSecrets` then the JSON pass, as a log entry goes */
function loggerMeta(value: unknown): unknown {
  logged.length = 0;
  logger.info('a row', value as Record<string, unknown>);
  return logged[0]?.meta;
}

const inputs = Object.entries(_SERIALISATION_INPUTS) as Array<[_SerialisationInput, () => unknown]>;

describe.each([
  ['loggerMeta', loggerMeta],
  ['redactSecrets', (value: unknown) => redactSecrets(value)],
  ['truncateResult', (value: unknown) => truncateResult(value)],
] as const)('%s answers its row', (pass, run) => {
  it.each(inputs)('for %s', (name, make) => {
    expect(_answer(() => run(make()))).toBe(_SERIALISATION_MATRIX[pass][name]);
  });
});
