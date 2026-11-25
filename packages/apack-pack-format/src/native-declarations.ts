import { _settingsJsonProblems } from '@apackdev/sdk/framework';
import { _NativePackDeclarationSchema } from './declaration-schema.ts';
import { _namingRefusedValue } from './refused-value.ts';

/** @internal Validate native composition data before copying it or touching executable bindings. */
export function _nativePackDeclarationProblem(declaration: unknown): string | undefined {
  const problems = _settingsJsonProblems(declaration);
  if (problems.length) return problems.map(problem => `${problem.path.join('.')}: declarations must contain finite, acyclic JSON data properties`).join('; ');
  const result = _NativePackDeclarationSchema.safeParse(declaration, { error: _namingRefusedValue });
  if (!result.success) return result.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; ');
}
