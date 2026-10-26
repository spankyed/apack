import { z } from 'zod';
import { _namingRefusedValue } from '../framework/refused-value.ts';

/** @internal Shared data validation for installed, source and native help declarations. */
export const _HelpDocumentsSchema = z.array(z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*$/),
  title: z.string().refine(value => value.trim().length > 0, 'A help title cannot be empty'),
  body: z.string(),
  features: z.array(z.string()).optional(),
  order: z.number().finite().optional(),
}).strict());

/** @internal Metadata admission never needs executable modules. */
export function _helpDataProblem(value: unknown, features: readonly string[]): string | undefined {
  const result = _HelpDocumentsSchema.safeParse(value, { error: _namingRefusedValue });
  if (!result.success) return result.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; ');
  const ids = new Set<string>();
  for (const article of result.data) {
    if (ids.has(article.id)) return `Duplicate help article "${article.id}"`;
    ids.add(article.id);
    const foreign = article.features?.find(feature => !features.includes(feature));
    if (foreign !== undefined) return `Help article "${article.id}" names undeclared feature "${foreign}"`;
  }
}
