// What each of the repo's value-serialising passes decided, as data.
//
// Five passes turn an arbitrary runtime value into something storable or sendable, and they differ — mostly on
// purpose. `docs/references/value-serialisation.md` explains why; this is the same answers in a form the specs
// can check, so a cell cannot drift from the code it describes.
//
// **Why it is data here rather than one spec somewhere.** The passes live in `@app/server`, `@apackdev/cli` and
// `@apackdev/sdk`, and no package may import all three: `@app/internal-repo-checks` is allowed `@apackdev/sdk` and
// `@apackdev/host` only. So the matrix is declared once and asserted from the three suites that can each reach
// their own, which between them cover all five rows.
//
// **Source-only export**, the shape `./testing/pack-fixture` uses: the `exports` entry names a path under
// `@apackdev/source` and nothing else, so `publishedManifest` drops it and no pack can resolve it. This is
// repo-internal test data, not something a pack author materialises.
//
// Depth is deliberately not a column. The caps are 10 (`truncateResult`), 50 (`redactSecrets`) and none (the
// encoder, which catches the stack overflow instead), so one input cannot ask all five the same question —
// each pass's own spec covers its cap.

/** What a cell says when the pass throws on that input */
export const _THROWS = '<throws>';

/**
 * A value as a comparable string, tagging the types JSON would flatten.
 *
 * `JSON.stringify` alone would report a Date and an ISO string identically, and `redactSecrets` keeping a Date
 * where the others produce a string is exactly the kind of difference this matrix exists to hold. BigInt is
 * tagged for the same reason, and because `JSON.stringify` refuses one outright.
 *
 * Keys are sorted, so a cell says what a pass produced and not the order the input happened to define things
 * in. Without that, reordering a field of an input silently rewrites a cell while no behaviour has changed.
 */
export function _describe(value: unknown, seen: WeakSet<object> = new WeakSet()): string {
  if (typeof value === 'bigint') return `<bigint ${value}>`;
  if (typeof value === 'function') return '<function>';
  if (value === undefined) return '<undefined>';
  if (value === null) return 'null';
  if (typeof value !== 'object') return JSON.stringify(value) ?? String(value);
  if (value instanceof Date) return `<date ${value.toISOString()}>`;
  if (seen.has(value)) return '<loop>';
  seen.add(value);
  try {
    if (Array.isArray(value)) return `[${value.map((entry) => _describe(entry, seen)).join(',')}]`;
    const fields = Object.entries(value)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, field]) => `${JSON.stringify(key)}:${_describe(field, seen)}`);
    return `{${fields.join(',')}}`;
  } finally {
    seen.delete(value);
  }
}

/**
 * What a pass answered for one input: the description of what it produced, or `_THROWS` when the pass threw.
 *
 * Only the pass's call is caught. Describing its result is this module's own work, so a bug there must fail the
 * run rather than quietly fill every cell with `_THROWS` and read as five passes that all throw.
 */
export function _answer(run: () => unknown): string {
  let produced: { value: unknown };
  try {
    produced = { value: run() };
  } catch {
    return _THROWS;
  }
  return _describe(produced.value);
}

/**
 * The inputs every pass is asked about.
 *
 * Builders rather than values: a loop has to be a fresh object per call, and a pass that mutates what it is
 * given would otherwise affect the next one.
 */
export const _SERIALISATION_INPUTS = {
  bigint: () => ({ n: 42n }),
  loop: () => {
    const row: Record<string, unknown> = { id: 'x' };
    row.self = row;
    return row;
  },
  repeated: () => {
    const shared = { id: 's' };
    return { left: shared, right: shared };
  },
  date: () => ({ at: new Date('2026-01-02T03:04:05.000Z') }),
  unreadable: () => {
    const row: Record<string, unknown> = { id: 'x' };
    Object.defineProperty(row, 'boom', { enumerable: true, get() { throw new Error('bang'); } });
    return row;
  },
  fn: () => ({ f: () => {} }),
  absent: () => ({ u: undefined }),
} as const;

export type _SerialisationInput = keyof typeof _SERIALISATION_INPUTS;

/**
 * One row per pass, one cell per input: what that pass answers, as `_describe` renders it.
 *
 * A spec asserts its own rows, so a change shows up where it was made. The rows are the five passes named in
 * the doc; `encoder` and `cliJson` produce JSON text, so their specs parse it before describing — which is why
 * their cells carry no `<date …>` or `<bigint …>` tag, those types having already become strings on the wire.
 */
export const _SERIALISATION_MATRIX = {
  encoder: {
    bigint: '{"n":"42"}',
    loop: '{"id":"x","self":"[circular]"}',
    repeated: '{"left":{"id":"s"},"right":{"id":"s"}}',
    date: '{"at":"2026-01-02T03:04:05.000Z"}',
    unreadable: _THROWS,
    fn: '{}',
    absent: '{}',
  },
  cliJson: {
    bigint: '{"n":"42"}',
    loop: '{"id":"x","self":"[Repeated]"}',
    repeated: '{"left":{"id":"s"},"right":"[Repeated]"}',
    date: '{"at":"2026-01-02T03:04:05.000Z"}',
    unreadable: _THROWS,
    fn: '{}',
    absent: '{}',
  },
  loggerMeta: {
    bigint: '{"n":"42"}',
    loop: '{"id":"x","self":"[Circular Reference]"}',
    repeated: '{"left":{"id":"s"},"right":{"id":"s"}}',
    date: '{"at":"2026-01-02T03:04:05.000Z"}',
    unreadable: _THROWS,
    fn: '{"f":"[Function]"}',
    absent: '{"u":"[Undefined]"}',
  },
  redactSecrets: {
    bigint: '{"n":<bigint 42>}',
    loop: '{"id":"x","self":"[Circular Reference]"}',
    repeated: '{"left":{"id":"s"},"right":{"id":"s"}}',
    date: '{"at":<date 2026-01-02T03:04:05.000Z>}',
    unreadable: _THROWS,
    fn: '{"f":<function>}',
    absent: '{"u":<undefined>}',
  },
  truncateResult: {
    bigint: '{"n":"42"}',
    loop: '{"id":"x","self":"[Circular]"}',
    repeated: '{"left":{"id":"s"},"right":{"id":"s"}}',
    date: '{"at":"2026-01-02T03:04:05.000Z"}',
    unreadable: '{"boom":"[Unreadable]","id":"x"}',
    fn: '{"f":<function>}',
    absent: '{"u":<undefined>}',
  },
} as const satisfies Record<string, Record<_SerialisationInput, string>>;

/** The passes the matrix covers, derived from it so a row cannot be added without being named */
export const _SERIALISATION_PASSES = Object.keys(_SERIALISATION_MATRIX) as ReadonlyArray<keyof typeof _SERIALISATION_MATRIX>;
