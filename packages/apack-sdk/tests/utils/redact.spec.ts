// Keeping API keys out of logs: key-shaped strings in text, the values of credential fields, and values the app has used
import { describe, expect, it } from 'vitest';
import { REDACTED, redactSecrets, redactSecretText, setSecretValueMatcher } from '../../src/utils/redact.ts';

// What the app binds as `HostRuntime.redaction`, which `bindHost` hands to redaction: here, the values themselves
const known = new Set<string>();
const registerSecretValue = (value: string) => {
  known.add(value);
  setSecretValueMatcher((text, from, to) => known.has(text.slice(from, to)));
};

describe('redactSecretText', () => {
  it.each([
    ['an OpenAI key', 'key sk-proj-abcdefghij1234567890'],
    ['an Anthropic key', 'key sk-ant-api03-abcdefghij1234567890'],
    ['a Groq key', 'key gsk_abcdefghij1234567890'],
    ['a Google key', 'key AIzaabcdefghij1234567890'],
    ['a key after an underscore', 'OPENAI_KEY_sk-abcdefghij1234567890'],
    ['a key after punctuation', 'Bearer:sk-abcdefghij1234567890'],
  ])('redacts %s', (_name, text) => {
    expect(redactSecretText(text)).toContain(REDACTED);
    expect(redactSecretText(text)).not.toContain('abcdefghij');
  });

  it('redacts the quoted values of credential fields in printed objects and JSON', () => {
    expect(redactSecretText(`{ apiKey: 'mistralkey123', 'x-api-key': "it's", nested: { authorization: 'Bearer abc' } }`))
      .toBe(`{ apiKey: '${REDACTED}', 'x-api-key': "${REDACTED}", nested: { authorization: '${REDACTED}' } }`);
    expect(redactSecretText(JSON.stringify({ token: 'abc\\"def', label: 'Work' }))).toBe(`{"token":"${REDACTED}","label":"Work"}`);
    expect(redactSecretText(`{ maxTokens: 'many', token: 5, password: '', secretName: 'Work' }`)).toBe(`{ maxTokens: 'many', token: 5, password: '', secretName: 'Work' }`);
  });

  it('leaves words that only contain a prefix, and short strings, alone', () => {
    expect(redactSecretText('task-abcdefghij1234567890')).toBe('task-abcdefghij1234567890');
    expect(redactSecretText('sk-short')).toBe('sk-short');
  });
});

describe('redactSecrets', () => {
  it("redacts credential fields whatever they hold (how prefix-less keys, like Mistral's, are caught)", () => {
    const redacted = redactSecrets({ apiKey: 'mistralkeywithnoprefix123456', nested: [{ note: 'sk-abcdefghij1234567890' }], label: 'Work' });
    expect(redacted).toEqual({ apiKey: REDACTED, nested: [{ note: REDACTED }], label: 'Work' });
  });

  it('copies a value reached twice each time, and marks only a value that contains itself', () => {
    const shared = { note: 'sk-abcdefghij1234567890' };
    const cyclic: Record<string, unknown> = { label: 'Work' };
    cyclic.self = cyclic;
    expect(redactSecrets({ first: shared, second: [shared], cyclic })).toEqual({
      first: { note: REDACTED },
      second: [{ note: REDACTED }],
      cyclic: { label: 'Work', self: '[Circular Reference]' },
    });
  });

  /**
   * A BigInt is passed through as one, and that is the boundary rather than an oversight.
   *
   * This pass redacts; it is not the pass that makes a value JSON can hold. Whoever stringifies afterwards owns
   * that, and each of them does: the logger's meta pass writes the digits, and the app's log appender and
   * socket encode through `jsonSafeEncoder`. Pinned so that nobody reading a downstream `JSON.stringify`
   * failure moves the fix in here, where it would silently change a number's type for every caller.
   */
  it('leaves a BigInt as a BigInt, redaction not being a JSON pass', () => {
    const redacted = redactSecrets({ count: 9007199254740993n, apiKey: 'sk-abcdefghij1234567890' });
    expect(redacted).toEqual({ count: 9007199254740993n, apiKey: REDACTED });
    expect(typeof (redacted as { count: unknown }).count).toBe('bigint');
  });

  it('replaces values nested past 50 levels with a marker instead of overflowing the stack', () => {
    const root: Record<string, unknown> = {};
    let node = root;
    for (let depth = 0; depth < 100_000; depth++) node = (node.next = {}) as Record<string, unknown>;
    let redacted = redactSecrets(root) as Record<string, unknown>;
    for (let depth = 0; depth < 50; depth++) {
      expect(typeof redacted).toBe('object');
      redacted = redacted.next as Record<string, unknown>;
    }
    expect(redacted).toBe('[Too deep]');
  });

  it("keeps an error's cause and own fields, and dates", () => {
    const at = new Date('2026-01-02T03:04:05Z');
    const error = Object.assign(new Error('401 for sk-abcdefghij1234567890', { cause: new Error('socket closed') }), { code: 'E_AUTH', status: 401 });
    const redacted = redactSecrets({ error, at }) as unknown as { error: Record<string, unknown>; at: Date };
    expect(redacted.error).toMatchObject({ name: 'Error', message: `401 for ${REDACTED}`, code: 'E_AUTH', status: 401, cause: { name: 'Error', message: 'socket closed' } });
    expect(redacted.at).toEqual(at);
  });

  it("keeps and redacts a SuppressedError's non-enumerable error and suppressed fields", () => {
    const err = new SuppressedError(
      new Error('cleanup failed for sk-abcdefghij1234567890'),
      new Error('primary failed for sk-proj-abcdefghij1234567890'),
      'An error was suppressed during disposal',
    );
    const redacted = redactSecrets(err) as unknown as Record<string, unknown>;
    expect(redacted).toMatchObject({
      name: 'SuppressedError',
      message: 'An error was suppressed during disposal',
      error: { name: 'Error', message: `cleanup failed for ${REDACTED}` },
      suppressed: { name: 'Error', message: `primary failed for ${REDACTED}` },
    });
  });
});

// How a key with no recognizable shape (Mistral, Cohere) is caught in text once the app has used it
describe('a key value the app has used', () => {
  /** A prefix-less key, and another token of the same shape the app never used */
  const KEY = 'not-a-real-key-with-no-prefix-01';
  const OTHER = 'not-a-real-token-no-prefix-0003';

  it('leaves token-like runs alone while nothing is registered', () => {
    expect(redactSecretText(`key ${KEY} job ${OTHER}`)).toBe(`key ${KEY} job ${OTHER}`);
  });

  it('masks a registered value in text and in nested data, and nothing else', () => {
    registerSecretValue(KEY);
    expect(redactSecretText(`key ${KEY} job ${OTHER}`)).toBe(`key ${REDACTED} job ${OTHER}`);
    expect(redactSecretText(`{"note":"used ${KEY}"}`)).toBe(`{"note":"used ${REDACTED}"}`);
    expect(redactSecrets({ note: `used ${KEY}`, job: OTHER })).toEqual({ note: `used ${REDACTED}`, job: OTHER });
  });

  it('masks a value printed against punctuation, in a longer run or between separators', () => {
    registerSecretValue(KEY);
    expect(redactSecretText(`Incorrect API key provided: ${KEY}.`)).toBe(`Incorrect API key provided: ${REDACTED}.`);
    expect(redactSecretText(`MISTRAL_KEY_${KEY}`)).toBe(`MISTRAL_KEY_${REDACTED}`);
    expect(redactSecretText(`${KEY}-old`)).toBe(`${REDACTED}-old`);
    expect(redactSecretText(`a.${KEY}.b`)).toBe(`a.${REDACTED}.b`);
    expect(redactSecretText(`Bearer ${KEY}, retrying`)).toBe(`Bearer ${REDACTED}, retrying`);
  });

  it('leaves a token that only contains part of a value', () => {
    registerSecretValue(KEY);
    expect(redactSecretText(`key ${KEY.slice(0, -1)}`)).toBe(`key ${KEY.slice(0, -1)}`);
    expect(redactSecretText(`key ${OTHER}`)).toBe(`key ${OTHER}`);
  });
});
