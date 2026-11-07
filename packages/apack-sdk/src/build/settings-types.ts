import type { SettingsDefinition } from '../framework/settings-definition.ts';
import { _compileSettingsDefinition } from '../framework/settings-validation.ts';

/** Generate value types from the schema, never infer narrow literal types from defaults. */
export async function generateSettingsTypes(definition: SettingsDefinition, name: string): Promise<string> {
  _compileSettingsDefinition(definition);
  const { compile } = await import('json-schema-to-typescript');
  return compile({ ...structuredClone(definition.schema), title: name }, name, {
    bannerComment: '', unknownAny: true,
    $refOptions: { resolve: { http: false, file: false } },
  });
}
