import { _NativePackDeclarationSchema, _EventContractsSchema } from './declaration-schema.ts';
import { _eventContractsProblem, type PackEventContracts } from './event-contracts.ts';
import { _settingsJsonProblems } from './settings-validation.ts';
import { _namingRefusedValue } from './refused-value.ts';

/** @internal Read compiled authoring data with the same grammar and ownership checks as snapshots. */
export function _parseEventContracts(data: unknown, features: Parameters<typeof _eventContractsProblem>[1], native = false): PackEventContracts {
  const contracts = _EventContractsSchema.parse(data);
  const problem = _eventContractsProblem(contracts, features, native);
  if (problem) throw new Error(problem);
  return contracts;
}

/** @internal Validate native composition data before copying it or touching executable bindings. */
export function _nativePackDeclarationProblem(declaration: unknown): string | undefined {
  const problems = _settingsJsonProblems(declaration);
  if (problems.length) return problems.map(problem => `${problem.path.join('.')}: declarations must contain finite, acyclic JSON data properties`).join('; ');
  const result = _NativePackDeclarationSchema.safeParse(declaration, { error: _namingRefusedValue });
  if (!result.success) return result.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; ');
}

/** @internal Check a runtime binding against host-validated declarations before registering it. */
export function _packDeclarationProblem(expected: { id: string; declarationRevision: string }, binding: unknown): string | undefined {
  if (!binding || typeof binding !== 'object') return `Pack "${expected.id}" does not export a registration`;
  if (!('id' in binding) || binding.id !== expected.id) return `Pack "${expected.id}" registration belongs to another pack`;
  if (!('declarationRevision' in binding) || binding.declarationRevision !== expected.declarationRevision) {
    return `Pack "${expected.id}" runtime does not match its declarations; rebuild and install the complete pack`;
  }
}
