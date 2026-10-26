/** A finding shared by pack authoring, build and installation checks. */
export interface PackDiagnostic {
  code: string;
  severity: 'error' | 'warning';
  packId?: string;
  /** Address in the declared source (apack.json by default); an empty path concerns the whole pack. */
  path: readonly (string | number)[];
  message: string;
  source?: string;
  suggestion?: string;
}

export interface SkippedPackCheck {
  check: string;
  reason: string;
}

export interface PackValidation {
  status: 'valid' | 'invalid' | 'incomplete';
  diagnostics: PackDiagnostic[];
  skippedChecks: SkippedPackCheck[];
}

/** A validation issue's path as a diagnostic's: a JSON document has no symbol keys, so one would be named by its description */
export function diagnosticPath(path: readonly PropertyKey[]): (string | number)[] {
  return path.map(key => typeof key === 'symbol' ? String(key.description) : key);
}

/** An error takes precedence over incompleteness; warnings alone do not invalidate a pack. */
export function packValidation(diagnostics: PackDiagnostic[] = [], skippedChecks: SkippedPackCheck[] = []): PackValidation {
  return {
    status: diagnostics.some(issue => issue.severity === 'error') ? 'invalid' : skippedChecks.length ? 'incomplete' : 'valid',
    diagnostics,
    skippedChecks,
  };
}
