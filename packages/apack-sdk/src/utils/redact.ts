// Keeps API keys out of logs and error reports: a backstop for anything that writes text or data it didn't build

/**
 * Strings shaped like provider API keys (OpenAI, Anthropic, Groq, Google), masked or not, wherever they start after a
 * character that isn't a letter or digit (`foo_sk-…` too). Mistral and Cohere keys have no prefix: text can't tell them
 * from other long tokens, so they're redacted as the values of credential fields below, and by value once the app has
 * used them (the app's `HostRuntime.redaction`).
 */
const KEY_SHAPED = /(?<![A-Za-z0-9])(?:sk-(?:ant-|proj-)?|gsk_|AIza)[A-Za-z0-9_\-*.…]{16,}/g;

/** Names of fields whose values are credentials, whatever they hold */
const SECRET_FIELD_NAMES = 'api[-_]?key|apikey|secret|client[-_]?secret|token|access[-_]?token|refresh[-_]?token|password|authorization|x-api-key';
const SECRET_FIELDS = new RegExp(`^(?:${SECRET_FIELD_NAMES})$`, 'i');

/**
 * A credential field's quoted, non-empty string value in text: printed objects (`apiKey: '…'`, `'x-api-key': '…'`)
 * and JSON (`"apiKey":"…"`). Groups: what comes before the value, then its quote.
 */
const SECRET_FIELD_TEXT = new RegExp(
  String.raw`((?<![A-Za-z0-9_-])(['"]?)(?:${SECRET_FIELD_NAMES})\2\s*:\s*)(['"${'`'}])(?:(?!\3)[^\\\n]|\\.)+\3`,
  'gi',
);

export const REDACTED = '[redacted]';

/** Objects nested deeper than this are replaced by a marker */
const MAX_DEPTH = 50;

/** The shortest run worth checking against the values the app has used */
const MIN_RUN = 20;

/** Whether `text` from `from` to `to` is a key value the app has used, from the app's `HostRuntime.redaction` */
let matchesSecretValue: ((text: string, from: number, to: number) => boolean) | undefined;

/**
 * Takes the check that tells redaction whether a run of characters is one of the key values this process has used, so
 * keys with no recognizable prefix (Mistral, Cohere) are masked too. `bindHost` calls this with the app's
 * `redaction`, and `unbindHost` clears it: the values belong to the host's secrets store, and the only way to decide
 * what counts as one is to be the app. This module is `@apackdev/sdk/utils/pure`, so it reads the bound app through
 * nothing — the binding pushes the check in, which also keeps the engine out of frontend bundles.
 *
 * @internal
 */
export function setSecretValueMatcher(matches: ((text: string, from: number, to: number) => boolean) | undefined): void {
  matchesSecretValue = matches;
}

const isRunChar = (code: number): boolean =>
  (code >= 97 && code <= 122) || (code >= 65 && code <= 90) || (code >= 48 && code <= 57)
  || code === 95 || code === 45 || code === 46; // _ - .

const isSeparator = (code: number): boolean => code === 95 || code === 45 || code === 46;

/**
 * `text` with the key values this process has used replaced, wherever they're printed: a value is found on its own, as
 * part of a longer run (`<key>.`, `prefix_<key>`), and between separators. One pass over the text, and a run is only
 * hashed when its length is one a stored value has, so text without keys costs a scan.
 */
function maskKnownValues(text: string): string {
  const matches = matchesSecretValue;
  if (!matches) return text;
  let out = '';
  let copiedTo = 0;
  for (let start = 0; start < text.length;) {
    if (!isRunChar(text.charCodeAt(start))) { start++; continue; }
    let end = start;
    while (end < text.length && isRunChar(text.charCodeAt(end))) end++;
    // The run itself, then the pieces its separators cut it into: a key keeps its own characters either way
    for (let from = start; from < end; from = isSeparator(text.charCodeAt(from)) ? from + 1 : nextSeparator(text, from, end)) {
      for (let to = end; to > from; to = previousSeparator(text, from, to)) {
        if (to - from < MIN_RUN) break;
        if (!matches(text, from, to)) continue;
        out += text.slice(copiedTo, from) + REDACTED;
        copiedTo = to;
        from = to;
        break;
      }
      if (from >= end) break;
    }
    start = end;
  }
  return copiedTo === 0 ? text : out + text.slice(copiedTo);
}

/** The next separator at or after `from`, else `end` */
function nextSeparator(text: string, from: number, end: number): number {
  let i = from;
  while (i < end && !isSeparator(text.charCodeAt(i))) i++;
  return i;
}

/** The last separator before `to`, else `from` */
function previousSeparator(text: string, from: number, to: number): number {
  let i = to - 1;
  while (i > from && !isSeparator(text.charCodeAt(i))) i--;
  return i > from ? i : from;
}

/**
 * `text` with key-shaped strings, the quoted values of credential fields printed in it, and the key values this process
 * has used (the app's `HostRuntime.redaction`), replaced
 */
export function redactSecretText(text: string): string {
  const masked = text
    .replace(SECRET_FIELD_TEXT, (_match, before: string, _nameQuote: string, quote: string) => `${before}${quote}${REDACTED}${quote}`)
    .replace(KEY_SHAPED, REDACTED);
  return maskKnownValues(masked);
}

/**
 * A copy of `value` with key-shaped strings, and the values of credential fields, replaced. Errors become plain objects
 * keeping their name, message, stack, cause, `errors` and own fields (`code`, `errno`, …); a value that contains itself shows a
 * marker where it repeats (a value reached twice by other paths is copied each time), and values nested deeper than
 * `MAX_DEPTH` show a marker too, so deep input never overflows the stack.
 */
export function redactSecrets<T>(value: T): T {
  const ancestors = new WeakSet<object>();
  let depth = 0;
  const visit = (current: unknown): unknown => {
    if (typeof current === 'string') return redactSecretText(current);
    if (current === null || typeof current !== 'object') return current;
    if (current instanceof Date) return new Date(current.getTime());
    if (ancestors.has(current)) return '[Circular Reference]';
    if (depth === MAX_DEPTH) return '[Too deep]';
    ancestors.add(current);
    depth++;
    try {
      if (Array.isArray(current)) return current.map(visit);
      const fields = Object.fromEntries(Object.entries(current).map(([key, field]) =>
        [key, SECRET_FIELDS.test(key) && field !== null && field !== undefined && field !== '' ? REDACTED : visit(field)]));
      if (!Error.isError(current)) return fields;
      // cause, AggregateError.errors, and SuppressedError.error/suppressed are non-enumerable own fields
      const { cause, errors, error, suppressed } = current as Error & {
        cause?: unknown; errors?: unknown; error?: unknown; suppressed?: unknown;
      };
      return {
        name: current.name,
        message: redactSecretText(current.message),
        ...(current.stack && { stack: redactSecretText(current.stack) }),
        ...(cause !== undefined && { cause: visit(cause) }),
        ...(Array.isArray(errors) && { errors: visit(errors) }),
        ...(error !== undefined && { error: visit(error) }),
        ...(suppressed !== undefined && { suppressed: visit(suppressed) }),
        ...fields,
      };
    } finally {
      depth--;
      ancestors.delete(current);
    }
  };
  return visit(value) as T;
}
