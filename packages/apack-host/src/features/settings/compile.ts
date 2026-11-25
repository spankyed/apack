import { Ajv, type ErrorObject } from 'ajv';
import {
  _assertSettingsDefinitionStructure,
  _settingsJsonProblems,
  type SettingsDefinition,
  type SettingsProblem,
  type SettingsValidator,
} from '@apackdev/sdk/framework';
import type { PackDiagnostic } from '@apackdev/sdk/build';
import { errorMessage } from '@apackdev/sdk/utils/pure';

const ajvOptions = { strict: true, allErrors: true, useDefaults: false, coerceTypes: false, removeAdditional: false } as const;
// This instance only validates schema documents against Ajv's built-in meta-schema. It never compiles
// or registers a pack's schema, so it cannot retain a pack's $id/reference namespace. Initialize lazily
// so importing host modules without compiling settings never constructs Ajv.
let metaSchemaChecker: Ajv | undefined;

/** Preserve value paths when host or build tools report invalid declared defaults. */
export class SettingsDefaultsError extends Error {
  readonly problems: readonly SettingsProblem[];
  constructor(problems: readonly SettingsProblem[]) {
    super(`Invalid settings defaults: ${problems.map(problem => `${problem.path.join('.') || 'root'}: ${problem.message}`).join('; ')}`);
    this.problems = problems;
  }
}

/**
 * Compile a settings definition's JSON Schema draft-07 and validate its declared defaults with Ajv.
 * Each definition gets its own Ajv instance so two packs may reuse the same schema `$id`.
 */
export function compileSettingsDefinition(definition: SettingsDefinition): SettingsValidator {
  _assertSettingsDefinitionStructure(definition);
  const schema = structuredClone(definition.schema);
  const checker = metaSchemaChecker ??= new Ajv(ajvOptions);
  if (!checker.validateSchema(schema)) throw new Error(`schema is invalid: ${checker.errorsText()}`);
  // Preserve independent reference resolution and strict compilation for every definition. Only the
  // already-performed meta-schema check is skipped here, avoiding its recompilation per definition.
  const ajv = new Ajv({ ...ajvOptions, validateSchema: false });
  const validate = ajv.compile(schema);
  const validator: SettingsValidator = {
    validate(value) {
      if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        return [{ path: [], keyword: 'type', message: 'Settings must be an object' }];
      }
      const problems = _settingsJsonProblems(value);
      if (problems.length) return problems;
      return validate(value) ? [] : (validate.errors ?? []).map(settingsProblem);
    },
  };
  const problems = validator.validate(definition.defaults);
  if (problems.length) {
    throw new SettingsDefaultsError(problems);
  }
  return validator;
}

function settingsProblem(error: ErrorObject): SettingsProblem {
  const path = error.instancePath === '' ? [] : error.instancePath.slice(1).split('/').map(part => part.replace(/~1/g, '/').replace(/~0/g, '~'));
  const property: unknown = error.keyword === 'required' ? error.params.missingProperty : error.keyword === 'additionalProperties' ? error.params.additionalProperty : undefined;
  if (typeof property === 'string') path.push(property);
  return { path, keyword: error.keyword, message: error.message ?? 'Invalid setting' };
}

export interface SettingsDeclarationContainer {
  readonly id?: string;
  readonly settings?: Readonly<Record<string, SettingsDefinition>>;
  readonly extensions?: { readonly settings?: Readonly<Record<string, SettingsDefinition>> };
  readonly features?: Readonly<Record<string, { readonly settings?: SettingsDefinition }>>;
}

/**
 * Validate every declared settings group and feature settings definition via Ajv, returning structured
 * diagnostics rooted at the owning declaration path (`extensions.settings.<group>`, `settings.<group>`,
 * or `features.<id>.settings`).
 */
export function settingsDeclarationDiagnostics(
  declaration: SettingsDeclarationContainer,
  options?: { readonly packId?: string; readonly source?: string; readonly codePrefix?: string; readonly label?: string; readonly pathPrefix?: readonly string[] },
): PackDiagnostic[] {
  const diagnostics: PackDiagnostic[] = [];
  const packId = options?.packId ?? declaration.id;
  const codePrefix = options?.codePrefix ?? 'manifest';
  const label = options?.label ?? 'apack.json';
  const pathPrefix = options?.pathPrefix ?? [];
  const check = (prefix: readonly string[], definition: SettingsDefinition): void => {
    try {
      compileSettingsDefinition(definition);
    } catch (error) {
      if (error instanceof SettingsDefaultsError) {
        for (const problem of error.problems) {
          const fullPath = [...pathPrefix, ...prefix, 'defaults', ...problem.path.map(String)];
          diagnostics.push({
            code: `${codePrefix}.custom`,
            severity: 'error',
            packId,
            path: fullPath,
            ...(options?.source !== undefined && { source: options.source }),
            message: `${label} "${fullPath.join('.')}": ${problem.message}`,
          });
        }
      } else {
        const fullPath = [...pathPrefix, ...prefix, 'schema'];
        diagnostics.push({
          code: `${codePrefix}.custom`,
          severity: 'error',
          packId,
          path: fullPath,
          ...(options?.source !== undefined && { source: options.source }),
          message: `${label} "${fullPath.join('.')}": ${errorMessage(error)}`,
        });
      }
    }
  };
  for (const [group, definition] of Object.entries(declaration.extensions?.settings ?? {})) {
    check(['extensions', 'settings', group], definition);
  }
  for (const [group, definition] of Object.entries(declaration.settings ?? {})) {
    check(['settings', group], definition);
  }
  for (const [featureId, feature] of Object.entries(declaration.features ?? {})) {
    if (feature.settings) check(['features', featureId, 'settings'], feature.settings);
  }
  return diagnostics;
}

/** Validate settings definitions on a native pack declaration, formatted like `_nativePackDeclarationProblem`. */
export function nativeDeclarationSettingsProblem(declaration: SettingsDeclarationContainer): string | undefined {
  const problems: string[] = [];
  const check = (prefix: readonly string[], definition: SettingsDefinition): void => {
    try {
      compileSettingsDefinition(definition);
    } catch (error) {
      if (error instanceof SettingsDefaultsError) {
        for (const problem of error.problems) {
          problems.push(`${[...prefix, 'defaults', ...problem.path.map(String)].join('.')}: ${problem.message}`);
        }
      } else {
        problems.push(`${[...prefix, 'schema'].join('.')}: ${errorMessage(error)}`);
      }
    }
  };
  for (const [group, definition] of Object.entries(declaration.settings ?? {})) {
    check(['settings', group], definition);
  }
  for (const [featureId, feature] of Object.entries(declaration.features ?? {})) {
    if (feature.settings) check(['features', featureId, 'settings'], feature.settings);
  }
  return problems.length ? problems.join('; ') : undefined;
}
