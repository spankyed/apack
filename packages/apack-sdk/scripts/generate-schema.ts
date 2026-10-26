import { declarationRecordGrammar } from '../src/framework/declaration-record.ts';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { zodToJsonSchema, parseDef, ignoreOverride } from 'zod-to-json-schema';
import { ManifestSchema } from '../src/framework/declaration-schema.ts';
import { SDK_ENTITIES, SDK_REL_KINDS, SDK_ROLES } from '../src/types/sdk-entities.ts';

const jsonSchema = zodToJsonSchema(ManifestSchema, {
  $refStrategy: 'none',
  override(def, refs) {
    const grammar = declarationRecordGrammar(def);
    return grammar ? parseDef({ ...grammar._def, description: def.description }, refs) : ignoreOverride;
  },
});

// The schema's refinements aren't JSON Schema: state the SDK's reserved names here, so editors flag them too
const properties = (jsonSchema as { properties: Record<string, Record<string, unknown>> }).properties;
const consumes = properties.consumes.properties as { services: Record<string, unknown> };
Object.assign(consumes.services, { uniqueItems: true });
// Editors validate the inline value schema with the same draft the runtime compiler accepts.
const extensions = properties.extensions.properties as Record<string, Record<string, unknown>>;
const settingsDefinition = extensions.settings.additionalProperties as { properties: { schema: Record<string, unknown>; defaults: Record<string, unknown> } };
Object.assign(settingsDefinition.properties.schema, { $ref: 'http://json-schema.org/draft-07/schema#' });
const feature = properties.features.additionalProperties as { properties: { settings: typeof settingsDefinition; entities: Record<string, unknown> } };
Object.assign(feature.properties.settings.properties.schema, { $ref: 'http://json-schema.org/draft-07/schema#' });
// Defaults are opaque JSON objects: runtime validation clones them without Zod record decoding.
const step = extensions.steps.additionalProperties as { properties: { node: { properties: { defaults: Record<string, unknown> } } } };
for (const defaults of [settingsDefinition.properties.defaults, feature.properties.settings.properties.defaults, step.properties.node.properties.defaults]) {
  Object.assign(defaults, { type: 'object', additionalProperties: {} });
}
const data = properties.data.properties as { entities: Record<string, unknown>; relations: Record<string, unknown>; roles: Record<string, unknown> };
for (const entities of [data.entities, feature.properties.entities]) {
  Object.assign(entities, { propertyNames: { ...(entities.propertyNames as object), not: { enum: Object.keys(SDK_ENTITIES) } } });
}
// A relation is a wire mapped to its rules: the SDK's wires are refused as keys
Object.assign(data.relations, {
  propertyNames: { ...(data.relations.propertyNames as object), not: { enum: Object.values(SDK_REL_KINDS) } },
});
Object.assign(data.roles, {
  uniqueItems: true,
  items: { ...(data.roles.items as object), not: { enum: Object.values(SDK_ROLES) } },
});

Object.assign(jsonSchema, {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://apack.dev/schemas/apack.json',
  $comment: 'Auto-generated from framework/declaration-schema.ts — do not edit by hand. Run: npm run schema:update',
  title: 'apack Pack Manifest',
  description: 'Configuration manifest for an apack pack. Declares metadata, features, entities, services, extensions, content, and build-time codegen inputs.',
});

const outPath = path.resolve(import.meta.dirname, '..', 'apack.schema.json');
const generated = JSON.stringify(jsonSchema, null, 2) + '\n';

if (process.argv.includes('--check')) {
  const existing = fs.existsSync(outPath) ? fs.readFileSync(outPath, 'utf-8') : '';
  if (existing !== generated) {
    console.error('apack.schema.json is out of date. Run: npm run schema:update');
    process.exit(1);
  }
  console.log('apack.schema.json is up to date.');
} else {
  fs.writeFileSync(outPath, generated);
  console.log(`Wrote ${outPath}`);
}
