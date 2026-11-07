import type { ComponentTarget } from './surface-declaration.ts';

/** JSON Schema draft-07 describing effective values, never sparse overrides. */
export type SettingsSchema = Record<string, unknown>;

/** The same data contract for host app, pack group and feature preferences. Forms remain custom. */
export interface SettingsDefinition {
  schema: SettingsSchema;
  defaults: Record<string, unknown>;
  title?: string;
  description?: string;
  form?: ComponentTarget;
  /** Owning packs and their dependents share access by default; owner restricts mutation. */
  access?: 'shared' | 'owner';
}

export interface SettingsProblem {
  path: readonly string[];
  message: string;
  keyword: string;
}

export interface SettingsValidator {
  validate(value: unknown): SettingsProblem[];
}
