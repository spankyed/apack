import type { QueryExplanation } from '@apackdev/ears';

const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const isTime = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const isCount = (value: unknown): value is number => isTime(value) && Number.isInteger(value);

/** Recognizes the backend-specific explanation shapes, including results received over the bus. */
export function isExplanation(value: unknown): value is QueryExplanation {
  if (!isRecord(value) || !Array.isArray(value.ids) || !value.ids.every(id => typeof id === 'string') || !isTime(value.ms)) return false;
  if (value.backend === 'elmdb') return isCount(value.visited) && Array.isArray(value.stages) && value.stages.every(stage =>
    isRecord(stage) && typeof stage.stage === 'string' && isTime(stage.ms) && isCount(stage.visited) && isCount(stage.kept)
    && (stage.index === undefined || typeof stage.index === 'string'));
  if (value.backend === 'sqlite') return isCount(value.statementCount) && Array.isArray(value.statements) && value.statementCount >= value.statements.length && value.statements.every(statement =>
    isRecord(statement) && typeof statement.sql === 'string' && Array.isArray(statement.parameters) && isTime(statement.ms)
    && isCount(statement.returnedRows) && Array.isArray(statement.plan) && statement.plan.every(step => isRecord(step)
      && typeof step.id === 'number' && Number.isFinite(step.id) && typeof step.parent === 'number' && Number.isFinite(step.parent)
      && typeof step.detail === 'string'));
  return false;
}
