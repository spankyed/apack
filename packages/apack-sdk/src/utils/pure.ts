// Environment-agnostic utilities — safe to import from browser/renderer code.
// Node-dependent code lives in ./index.ts (the '@apackdev/sdk/utils' barrel).
// When adding a new pure utility, export it from here; if it needs fs/path/etc, export from index.ts only.
export * from './api.ts';
export * from './web-url.ts';
export * from './shared.ts';
export * from './compare-versions.ts';
export { randomId, type RandomIdOptions } from './random-id.ts';
export { escapeHtml } from './escape-html.ts';
export { _pathSegmentProblem } from './path-segment.ts';
export * from './change-mapping.ts';
export * from './change-detection.ts';
export { redactSecrets, redactSecretText, REDACTED } from './redact.ts';
