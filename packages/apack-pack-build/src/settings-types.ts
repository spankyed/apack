import { compile } from 'json-schema-to-typescript';
import { _assertSettingsDefinitionStructure, type SettingsDefinition } from '@apackdev/sdk/framework';

/** Generate value types from the schema, never infer narrow literal types from defaults. */
export async function generateSettingsTypes(
  definition: SettingsDefinition,
  name: string,
  options?: { validate?: (definition: SettingsDefinition) => void },
): Promise<string> {
  _assertSettingsDefinitionStructure(definition);
  options?.validate?.(definition);
  return compile({ ...structuredClone(definition.schema), title: name }, name, {
    bannerComment: '', unknownAny: true,
    $refOptions: { resolve: { http: false, file: false } },
  });
}
