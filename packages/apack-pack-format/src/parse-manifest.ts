import { ManifestSchema } from './declaration-schema.ts';
import { diagnosticPath, packValidation, type PackDiagnostic, type PackValidation } from './diagnostics.ts';
import { _namingRefusedValue } from './refused-value.ts';

export function parseManifest(raw: unknown): PackValidation {
  const result = ManifestSchema.safeParse(raw, { error: _namingRefusedValue });
  if (result.success) return packValidation();
  const packId = raw && typeof raw === 'object' && 'id' in raw && typeof raw.id === 'string' ? raw.id : undefined;

  const diagnostics: PackDiagnostic[] = result.error.issues.map(issue => {
    const fieldPath = issue.path.length > 0 ? `"${issue.path.join('.')}"` : 'root';
    return {
      code: `manifest.${issue.code}`, severity: 'error', packId, path: diagnosticPath(issue.path),
      message: `apack.json ${fieldPath}: ${issue.message}`,
    };
  });
  return packValidation(diagnostics);
}
