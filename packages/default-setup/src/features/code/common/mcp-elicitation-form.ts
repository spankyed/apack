import { z } from 'zod';

export type ClaudeMcpFormValue = string | number | boolean | string[];
export interface ClaudeMcpFormField {
  name: string;
  type: 'string' | 'number' | 'integer' | 'boolean' | 'array';
  title: string;
  description?: string;
  required: boolean;
  options?: Array<{ value: string; label: string }>;
  minLength?: number;
  maxLength?: number;
  format?: 'email' | 'uri' | 'date' | 'date-time';
  minimum?: number;
  maximum?: number;
  minItems?: number;
  maxItems?: number;
  default?: ClaudeMcpFormValue;
}
export interface ClaudeMcpElicitationResponse { buttonId: 'accept' | 'decline' | 'cancel'; content?: Record<string, ClaudeMcpFormValue> }
export interface ClaudeMcpForm { fields: ClaudeMcpFormField[] }
export interface ClaudeMcpFormValidation { valid: boolean; errors: Record<string, string>; content?: Record<string, ClaudeMcpFormValue> }
const metadata = { title: z.string().optional(), description: z.string().optional() };
const bound = z.number().finite().optional();
const titled = z.object({ const: z.string(), title: z.string() }).strict();
const field = z.union([
  z.object({ type: z.literal('string'), ...metadata, enum: z.array(z.string()).min(1).max(512), enumNames: z.array(z.string()).optional(), default: z.string().optional() }).strict(),
  z.object({ type: z.literal('string'), ...metadata, oneOf: z.array(titled).min(1).max(512), default: z.string().optional() }).strict(),
  z.object({ type: z.literal('string'), ...metadata, minLength: bound, maxLength: bound, format: z.enum(['email', 'uri', 'date', 'date-time']).optional(), default: z.string().optional() }).strict(),
  z.object({ type: z.enum(['number', 'integer']), ...metadata, minimum: bound, maximum: bound, default: z.number().finite().optional() }).strict(),
  z.object({ type: z.literal('boolean'), ...metadata, default: z.boolean().optional() }).strict(),
  z.object({ type: z.literal('array'), ...metadata, minItems: bound, maxItems: bound, items: z.union([
    z.object({ type: z.literal('string'), enum: z.array(z.string()).min(1).max(512) }).strict(),
    z.object({ anyOf: z.array(titled).min(1).max(512) }).strict(),
  ]), default: z.array(z.string()).optional() }).strict(),
]);
const schema = z.object({ type: z.literal('object'), properties: z.record(z.string(), field), required: z.array(z.string()).optional(),
  title: z.string().optional(), description: z.string().optional(), $schema: z.string().optional(), additionalProperties: z.boolean().optional(),
}).strict();

/** Interpret the pinned native MCP primitive form surface; unknown constructs fail visibly. */
export function parseMcpElicitationForm(input: unknown, propertyOrder?: string[]): ClaudeMcpForm {
  if ((JSON.stringify(input)?.length ?? 0) > 65536) throw new Error('MCP form schema exceeds the app limit');
  if (input && typeof input === 'object' && 'properties' in input && input.properties && typeof input.properties === 'object' && Object.hasOwn(input.properties, '__proto__')) throw new Error('Unsupported MCP form property name');
  const parsed = schema.parse(input), names = Object.keys(parsed.properties);
  if (names.length > 128) throw new Error('MCP form has too many fields');
  if (parsed.required?.some(name => !Object.hasOwn(parsed.properties, name))) throw new Error('MCP form requires an undefined field');
  const order = [...new Set([...(propertyOrder ?? []).filter(name => names.includes(name)), ...names])];
  return { fields: order.map(name => {
    const definition = parsed.properties[name]!;
    const result: ClaudeMcpFormField = { name, title: definition.title ?? name, description: definition.description, type: definition.type, required: parsed.required?.includes(name) ?? false };
    if ('default' in definition) result.default = definition.default;
    if ('enum' in definition) result.options = definition.enum.map((value, index) => ({ value, label: definition.enumNames?.[index] ?? value }));
    if ('oneOf' in definition) result.options = definition.oneOf.map(item => ({ value: item.const, label: item.title }));
    if (definition.type === 'array') {
      result.options = 'enum' in definition.items ? definition.items.enum.map(value => ({ value, label: value })) : definition.items.anyOf.map(item => ({ value: item.const, label: item.title }));
      result.minItems = definition.minItems; result.maxItems = definition.maxItems;
    }
    if (definition.type === 'string' && !('enum' in definition) && !('oneOf' in definition)) { result.minLength = definition.minLength; result.maxLength = definition.maxLength; result.format = definition.format; }
    if (definition.type === 'number' || definition.type === 'integer') { result.minimum = definition.minimum; result.maximum = definition.maximum; }
    return result;
  }) };
}
function valueSchema(field: ClaudeMcpFormField): z.ZodTypeAny {
  if (field.type === 'array') {
    let rule = z.array(z.string().refine(value => field.options?.some(option => option.value === value), 'Choose a listed option'));
    if (field.minItems !== undefined) rule = rule.min(field.minItems);
    if (field.maxItems !== undefined) rule = rule.max(field.maxItems);
    return rule;
  }
  if (field.options) return z.string().refine(value => field.options!.some(option => option.value === value), 'Choose a listed option');
  if (field.type === 'boolean') return z.boolean();
  if (field.type === 'number' || field.type === 'integer') {
    let rule = z.number().finite(); if (field.type === 'integer') rule = rule.int();
    if (field.minimum !== undefined) rule = rule.min(field.minimum); if (field.maximum !== undefined) rule = rule.max(field.maximum);
    return rule;
  }
  let rule = z.string(); if (field.minLength !== undefined) rule = rule.min(field.minLength); if (field.maxLength !== undefined) rule = rule.max(field.maxLength);
  if (field.format === 'email') rule = rule.email(); if (field.format === 'uri') rule = rule.url();
  if (field.format === 'date') rule = rule.date(); if (field.format === 'date-time') rule = rule.datetime({ offset: true });
  return rule;
}
/** Validate without coercion, default insertion or silently deleting unknown response properties. */
export function validateMcpElicitationForm(form: ClaudeMcpForm, input: unknown): ClaudeMcpFormValidation {
  if (!input || typeof input !== 'object' || Array.isArray(input) || (JSON.stringify(input)?.length ?? 0) > 65536) return { valid: false, errors: { '': 'Form response must be a bounded object' } };
  const values = input as Record<string, unknown>, errors: Array<[string, string]> = [], content: Array<[string, ClaudeMcpFormValue]> = [];
  const known = new Set(form.fields.map(field => field.name));
  for (const name of Object.keys(values)) if (!known.has(name)) errors.push([name, 'Unknown field']);
  for (const field of form.fields) {
    const value = Object.hasOwn(values, field.name) ? values[field.name] : undefined;
    const empty = value === undefined || value === null || value === '' || (Array.isArray(value) && !value.length);
    if (empty) { if (field.required) errors.push([field.name, 'Required']); continue; }
    const parsed = valueSchema(field).safeParse(value);
    if (parsed.success) content.push([field.name, parsed.data as ClaudeMcpFormValue]);
    else errors.push([field.name, parsed.error.issues.map(issue => issue.message).join('; ')]);
  }
  return errors.length ? { valid: false, errors: Object.fromEntries(errors) } : { valid: true, errors: {}, content: Object.fromEntries(content) };
}
