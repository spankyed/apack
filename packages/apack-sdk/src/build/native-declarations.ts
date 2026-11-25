import { _NativePackDeclarationSchema } from '../framework/declaration-schema.ts';
import { _settingsJsonProblems } from '../framework/settings-json.ts';
import { _namingRefusedValue } from '../framework/refused-value.ts';

/** @internal Validate native composition data before copying it or touching executable bindings. */
export function _nativePackDeclarationProblem(declaration: unknown): string | undefined {
  const problems = _settingsJsonProblems(declaration);
  if (problems.length) return problems.map(problem => `${problem.path.join('.')}: declarations must contain finite, acyclic JSON data properties`).join('; ');
  const result = _NativePackDeclarationSchema.safeParse(declaration, { error: _namingRefusedValue });
  if (!result.success) return result.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; ');
}
