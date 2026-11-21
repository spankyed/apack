import type { StepCompileResult, StepValidationError, StepValidationContext, StepCompileContext, StepDecompileContext } from '@apackdev/sdk/steps';
import { EARS } from '@apackdev/sdk';
import { expandRecord, collapseRecord, mapProblems } from '@apackdev/sdk/steps';
import type { FieldMapping, MapEntry } from '@apackdev/sdk/steps';
import { isPlainObject } from '@apackdev/sdk/utils/pure';
import { RESERVED_ATTRIBUTES } from '@apackdev/sdk/ears';

export function compile(node: Record<string, unknown>, nodeId: string, ts: number, _ctx: StepCompileContext): StepCompileResult {
  return {
    entity: {
      id: nodeId,
      entityType: EARS.Entity.Node,
      createdAt: ts,
      nodeType: 'create',
      label: (node.label as string) || `Create ${node.entity}`,
      description: node.description,
      entityTypeTarget: node.entity as EARS.Entity,
      params: node.params,
      fieldMappings: expandRecord(node.map as Record<string, MapEntry> | undefined),
      inferLabel: node.inferLabel,
      final: node.final,
    },
    relations: [],
  };
}

/**
 * Errors for a step's `map` and `params` fields, shared with the update step. A field the engine writes itself (an
 * entity's id, type, creation time, roles and relations) is refused here, so a flow says so when it is saved rather
 * than when the step runs and the write throws.
 */
export function validateFields(s: Record<string, unknown>, path: string): StepValidationError[] {
  const errors: StepValidationError[] = [...mapProblems(s.map, `${path}.map`)];
  if (s.params !== undefined && !isPlainObject(s.params)) {
    errors.push({ path: `${path}.params`, message: '"params" must be an object { field: value }' });
  }
  for (const key of ['map', 'params'] as const) {
    const fields = s[key];
    if (!isPlainObject(fields)) continue;
    for (const field of Object.keys(fields)) {
      if ((RESERVED_ATTRIBUTES as readonly string[]).includes(field)) {
        errors.push({ path: `${path}.${key}.${field}`, message: `"${field}" is written by the database itself, so a step can't set it` });
      }
    }
  }
  return errors;
}

export function validate(s: Record<string, unknown>, path: string, _ctx: StepValidationContext): StepValidationError[] {
  const errors: StepValidationError[] = [];
  if (!s.entity || typeof s.entity !== 'string') {
    errors.push({ path, message: 'Create step must have an "entity" string (entity type)' });
  }
  if (s.inferLabel !== undefined && typeof s.inferLabel !== 'boolean') {
    errors.push({ path: `${path}.inferLabel`, message: '"inferLabel" must be a boolean' });
  }
  return [...errors, ...validateFields(s, path)];
}

export function getLabel(step: Record<string, unknown>, index: number): string {
  if (typeof step.label === 'string') return step.label;
  return `Create ${step.entity || index}`;
}

export function decompile(node: Record<string, unknown>, _ctx: StepDecompileContext): Record<string, unknown> {
  const dsl: Record<string, unknown> = { type: 'create', entity: node.entityTypeTarget };
  if (node.label) dsl.label = node.label;
  if (node.description) dsl.description = node.description;
  if (node.final) dsl.final = true;
  const map = collapseRecord(node.fieldMappings as FieldMapping[] | undefined);
  if (map) dsl.map = map;
  if (node.params && Object.keys(node.params as object).length > 0) dsl.params = node.params;
  if (typeof node.inferLabel === 'boolean') dsl.inferLabel = node.inferLabel;
  return dsl;
}
