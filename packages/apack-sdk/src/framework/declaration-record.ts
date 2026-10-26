import { z } from 'zod';
import { _namingRefusedValue } from './refused-value.ts';

const recordGrammar = Symbol('declaration record grammar');
type RecordDefinition = { [recordGrammar]?: z.ZodType };
type StringKey = z.core.$ZodType<string, string>;
// A nested parse starts without its caller's error map, so it names a refused value itself, as every
// authoring parse does (`_namingRefusedValue`)
const nested = { error: _namingRefusedValue };

/**
 * Validate dictionary entries without Zod's record dropping an own __proto__ key. Enum keys are each
 * optional, as a dictionary's are.
 */
export function declarationRecord<K extends z.ZodEnum, V extends z.ZodType>(key: K, value: V):
  z.ZodType<z.output<z.ZodRecord<K & z.core.$partial, V>>, z.input<z.ZodRecord<K & z.core.$partial, V>>>;
export function declarationRecord<K extends StringKey, V extends z.ZodType>(key: K, value: V):
  z.ZodType<z.output<z.ZodRecord<K, V>>, z.input<z.ZodRecord<K, V>>>;
export function declarationRecord<V extends z.ZodType>(value: V):
  z.ZodType<z.output<z.ZodRecord<z.ZodString, V>>, z.input<z.ZodRecord<z.ZodString, V>>>;
export function declarationRecord(keyOrValue: z.ZodType, value?: z.ZodType): z.ZodType {
  const key = (value === undefined ? z.string() : keyOrValue) as StringKey;
  const grammar = key instanceof z.ZodEnum
    ? z.partialRecord(key, value ?? keyOrValue)
    : z.record(key, value ?? keyOrValue);
  const entries = z.array(z.tuple([key, value ?? keyOrValue]));
  const schema = z.unknown().transform((raw, ctx) => {
    if (!isDictionary(raw)) {
      const result = grammar.safeParse(raw, nested);
      for (const issue of result.success ? [] : result.error.issues) ctx.issues.push(reported(issue, raw, issue.path));
      if (result.success) ctx.issues.push({ code: 'invalid_type', expected: 'record', input: raw, message: 'Expected a dictionary' });
      return z.NEVER;
    }
    const input = Object.entries(raw);
    const result = entries.safeParse(input, nested);
    if (!result.success) {
      // An entry's issue is at [index, 0 (key) | 1 (value), ...]: report it under the key, as a record would
      for (const issue of result.error.issues) {
        ctx.issues.push(reported(issue, raw, [input[Number(issue.path[0])]![0], ...issue.path.slice(2)]));
      }
      return z.NEVER;
    }
    return Object.fromEntries(result.data);
  });
  // A copy made by describe() or meta() shares this definition, so formatters find the grammar through either
  Object.assign(schema._zod.def, { [recordGrammar]: grammar });
  return schema;
}

/** Any object but the kinds a record refuses: an array, a promise, a map, a set or a date */
function isDictionary(raw: unknown): raw is object {
  return typeof raw === 'object' && raw !== null && !Array.isArray(raw) && typeof (raw as { then?: unknown }).then !== 'function'
    && !(raw instanceof Map) && !(raw instanceof Set) && !(raw instanceof Date);
}

/** An issue a nested parse finalized, raised again from the dictionary; its message is already written */
function reported(issue: z.core.$ZodIssue, input: unknown, path: PropertyKey[]): z.core.$ZodRawIssue {
  return { ...issue, input, path } as z.core.$ZodRawIssue;
}

/** JSON Schema tooling can render the dictionary's grammar without exposing its decoding representation. */
export function declarationRecordGrammar(schema: z.core.$ZodType): z.ZodType | undefined {
  return (schema._zod.def as RecordDefinition)[recordGrammar];
}
