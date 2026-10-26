import type { z } from 'zod';

const shown = (value: unknown) => typeof value === 'string' ? JSON.stringify(value) : String(value);

/**
 * @internal A parse's error map that names the value an enum or literal refused, which Zod's own message leaves
 * out: an author fixing a misspelled option needs to see what they wrote. A message a schema declares outranks
 * it, and every other issue keeps Zod's.
 */
export const _namingRefusedValue: z.core.$ZodErrorMap = (issue) => {
  if (issue.code !== 'invalid_value') return undefined;
  const expected = issue.values.length === 1
    ? `expected ${shown(issue.values[0])}`
    : `expected one of ${issue.values.map(shown).join(' | ')}`;
  return `Invalid option: ${expected}, received ${shown(issue.input)}`;
};
