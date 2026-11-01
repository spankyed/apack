import { Ajv } from 'ajv';
import { ELMDB_SCHEMA_LANGUAGE } from '../schema.ts';
import { RESERVED_ATTRIBUTES } from '../errors.ts';

type Data = Record<string, any>;
const refuse = (code: string, path: string, message: string): never => {
  throw Object.assign(new Error(`${path}: ${message}`), { code });
};

/** Validate the app's declaration language before any layout/index/metadata writes. State belongs to its owner. */
export function createSchemaValidator(): (input: unknown) => void {
  const object = (properties: Data, required: string[] = []) => ({ type: 'object', properties, required, additionalProperties: false });
  const strings = (minItems = 1) => ({ type: 'array', items: { type: 'string' }, minItems });
  const named = (ref: string) => ({ type: 'object', additionalProperties: { $ref: `#/definitions/${ref}` } });
  const declaredBy = { type: ['string', 'null'] };
  const value = (flags: boolean) => ({ oneOf: [
    ...['string', 'number', 'integer', 'boolean', 'bytes', 'object', 'any'].map(type => object({ type: { const: type }, ...(flags ? { optional: { type: 'boolean' }, nullable: { type: 'boolean' } } : {}) }, ['type'])),
    ...[
      { type: { const: 'enum' }, values: { ...strings(), uniqueItems: true } },
      { type: { const: 'ref' }, to: strings() },
      { type: { const: 'list' }, of: { $ref: '#/definitions/value' } },
    ].map(properties => object({ ...properties, ...(flags ? { optional: { type: 'boolean' }, nullable: { type: 'boolean' } } : {}) }, Object.keys(properties))),
  ] });
  const compiled = new Ajv({ allErrors: true, strict: true, ownProperties: true }).compile({
    ...object({
      $schema: { const: ELMDB_SCHEMA_LANGUAGE }, collation: { type: 'string' },
      types: named('entity'), roles: named('role'), relations: named('relation'),
      ranks: { type: 'object', additionalProperties: { type: 'object' } },
    }, ['$schema', 'types', 'roles', 'relations']),
    definitions: {
      value: value(false), field: value(true), role: object({ declaredBy }),
      entity: object({
        declaredBy, fields: named('field'), indexes: named('index'),
        additionalFields: { enum: ['allow', 'refuse'] },
        shortCode: object({ prefix: { type: 'string', pattern: '^[A-Z][A-Z0-9]{0,7}$' } }, ['prefix']),
      }),
      relation: object({
        declaredBy, cardinality: { enum: ['many-to-many', 'one-to-one', 'one-to-many', 'many-to-one'] },
        acyclic: { type: 'boolean' }, weighted: { type: 'boolean' }, key: { ...strings(0), uniqueItems: true }, info: { $ref: '#/definitions/field' },
        endpoints: { anyOf: [{ type: 'null' }, { type: 'array', minItems: 1, items: object({ source: { type: 'string' }, target: { type: 'string' } }, ['source', 'target']) }] },
      }, ['cardinality']),
      index: { oneOf: [
        object({ kind: { const: 'value' }, fields: strings(), unique: { type: 'boolean' } }, ['kind', 'fields']),
        object({ kind: { const: 'text' }, fields: { type: 'object', minProperties: 1, additionalProperties: object({ weight: { type: 'number', exclusiveMinimum: 0 } }) },
          analyzer: { enum: ['standard', 'exact'] }, stem: { type: ['string', 'null'] } }, ['kind', 'fields']),
        object({ kind: { const: 'trigram' }, fields: strings() }, ['kind', 'fields']),
        object({ kind: { const: 'vector' }, from: strings(), chunk: { enum: ['whole', 'paragraph'] },
          dims: { type: 'integer', minimum: 1, maximum: 4294967295 }, metric: { enum: ['cosine', 'l2', 'dot'] },
          precision: { enum: ['f32', 'f16', 'i8', 'binary'] }, model: { type: 'string', pattern: '\\S' } }, ['kind', 'from', 'dims', 'model']),
      ] },
    },
  });
  const json = (input: unknown, path: string, depth = 0): void => {
    if (depth > 64) refuse('SCHEMA_INVALID', path, 'declaration exceeds 64 levels');
    if (input === null || typeof input === 'string' || typeof input === 'boolean' || (typeof input === 'number' && Number.isFinite(input))) return;
    if (Array.isArray(input)) { input.forEach((item, i) => json(item, `${path}[${i}]`, depth + 1)); return; }
    if (typeof input === 'object' && input !== null && [Object.prototype, null].includes(Object.getPrototypeOf(input))) {
      for (const [key, value] of Object.entries(input)) json(value, `${path}.${key}`, depth + 1);
      return;
    }
    refuse('SCHEMA_INVALID', path, 'declarations contain only JSON values');
  };
  const name = (path: string, value: string, pattern: RegExp, what: string) => {
    if (!pattern.test(value)) refuse('SCHEMA_INVALID', path, `a ${what}'s name has an invalid form`);
  };
  return input => {
    json(input, 'schema');
    if (!compiled(input)) {
      const problems = compiled.errors!.map(error => `${error.instancePath || 'schema'} ${error.message}`);
      refuse('SCHEMA_INVALID', 'schema', problems.join('; '));
    }
    const schema = input as Data, prefixes = new Set<string>();
    if (Object.keys(schema.ranks ?? {}).length)
      refuse('UNSUPPORTED', 'ranks', 'SQLite does not implement named maintained rank indexes');
    const reference = (type: string, path: string) => {
      if (!Object.hasOwn(schema.types, type)) refuse('SCHEMA_INVALID', path, `no such type "${type}"`);
    };
    const checkValue = (rule: Data, path: string): void => {
      if (rule.type === 'ref') for (const type of rule.to) reference(type, `${path}.to`);
      if (rule.type === 'list') checkValue(rule.of, `${path}.of`);
    };
    const text = (rule: Data) => rule.type === 'any' || rule.type === 'string' || (rule.type === 'list' && rule.of.type === 'string');
    const indexable = (rule: Data): boolean => rule.type === 'list'
      ? rule.of.type !== 'list' && indexable(rule.of) : !['bytes', 'object'].includes(rule.type);
    for (const role of Object.keys(schema.roles)) name(`roles.${role}`, role, /^[a-z][a-z0-9_]*$/, 'role');
    for (const [kind, definition] of Object.entries(schema.relations) as Array<[string, Data]>) {
      name(`relations.${kind}`, kind, /^[a-z][a-z0-9_]*$/, 'relation kind');
      if (definition.endpoints) for (const end of definition.endpoints) {
        reference(end.source, `relations.${kind}.endpoints.source`); reference(end.target, `relations.${kind}.endpoints.target`);
      }
      if (definition.info) checkValue(definition.info, `relations.${kind}.info`);
      for (const field of definition.key ?? []) name(`relations.${kind}.key`, field, /^[a-z][A-Za-z0-9]*$/, 'key field');
      if (definition.key?.length && definition.info && !['object', 'any'].includes(definition.info.type))
        refuse('SCHEMA_INVALID', `relations.${kind}.key`, 'key fields require object or any info');
      if (definition.cardinality !== 'many-to-many' || definition.endpoints != null ||
          (definition.info && (definition.info.type !== 'any' || !definition.info.optional || !definition.info.nullable)))
        refuse('UNSUPPORTED', `relations.${kind}`, 'SQLite currently supports unconstrained many-to-many endpoints and optional any info');
    }
    if (schema.collation !== undefined) {
      if (schema.collation !== 'root' && !/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(schema.collation))
        refuse('SCHEMA_INVALID', 'collation', 'expected root or a locale such as en');
      try { new Intl.Collator(schema.collation === 'root' ? 'und' : schema.collation); }
      catch { refuse('SCHEMA_INVALID', 'collation', 'locale is not supported'); }
    }
    for (const [type, definition] of Object.entries(schema.types) as Array<[string, Data]>) {
      // Preserve the established type-name diagnostic used by the facade's refusal contract.
      if (!/^[A-Z][A-Za-z0-9]*$/.test(type)) throw Object.assign(new Error(`The schema has 1 problem:\ntypes.${type}: a type's name is PascalCase, which ${JSON.stringify(type)} isn't`), { code: 'SCHEMA_INVALID' });
      if (type === 'Relation') refuse('SCHEMA_INVALID', `types.${type}`, 'Relation is reserved');
      const prefix = definition.shortCode?.prefix;
      if (prefix !== undefined) {
        if (prefixes.has(prefix)) refuse('SCHEMA_INVALID', `types.${type}.shortCode.prefix`, 'prefix is already declared by another type');
        prefixes.add(prefix);
      }
      if (definition.additionalFields === 'refuse') refuse('UNSUPPORTED', `types.${type}.additionalFields`, 'SQLite currently permits additional fields');
      const fields = definition.fields ?? {};
      for (const [field, rule] of Object.entries(fields) as Array<[string, Data]>) {
        name(`types.${type}.fields.${field}`, field, /^[a-z][A-Za-z0-9]*$/, 'field');
        if ((RESERVED_ATTRIBUTES as readonly string[]).includes(field)) refuse('SCHEMA_INVALID', `types.${type}.fields.${field}`, 'the engine writes this field');
        checkValue(rule, `types.${type}.fields.${field}`);
      }
      for (const [index, rule] of Object.entries(definition.indexes ?? {}) as Array<[string, Data]>) {
        const path = `types.${type}.indexes.${index}`;
        name(path, index, /^[a-z][A-Za-z0-9]*$/, 'index');
        if (index === 'role' || index === 'shortCode') refuse('SCHEMA_INVALID', path, 'the engine owns this index');
        const selected: string[] = rule.kind === 'text' ? Object.keys(rule.fields) : rule.kind === 'vector' ? rule.from : rule.fields;
        if (new Set(selected).size !== selected.length) refuse('SCHEMA_INVALID', path, 'a field is named twice');
        for (const field of selected) {
          if (rule.kind === 'value' && ['createdAt', 'updatedAt'].includes(field)) continue;
          if (!Object.hasOwn(fields, field)) refuse('SCHEMA_INVALID', path, `no such field "${field}" on ${type}`);
          if (!(rule.kind === 'value' ? indexable(fields[field]) : text(fields[field]))) refuse('SCHEMA_INVALID', path, `index cannot read field "${field}"`);
        }
        if (rule.kind === 'value' && (rule.fields.length !== 1 || rule.unique)) refuse('SCHEMA_INVALID', path, 'SQLite value indexes require one field and do not declare uniqueness');
        if (rule.kind === 'text' && ((rule.analyzer && rule.analyzer !== 'standard') || (rule.stem && rule.stem !== 'en')))
          refuse('UNSUPPORTED', path, 'SQLite currently supports the standard analyzer and English stemming');
        if (rule.kind === 'vector' && ((rule.metric && rule.metric !== 'cosine') || (rule.precision && rule.precision !== 'f32')))
          refuse('UNSUPPORTED', path, 'SQLite currently supports cosine distance over f32 vectors');
      }
    }
  };
}
