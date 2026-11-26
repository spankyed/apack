// Mechanical clock-boundary check: domain services, repositories, and database helpers under `@apackdev/sdk` and
// `@apackdev/host` must read wall time from the engine (`engine.now()` / `now()`) and schedule timers through an
// injected `Clock` (`clock.after(...)`) rather than bare `Date.now()`, `setTimeout()`, or `setInterval()`.
//
// Intentional exceptions (for example, a fallback timer when no clock is injected or an OS watchdog) must carry an
// inline or preceding-line justification comment: `// clock-boundary-ok: <reason>`.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

const MONITORED_DIRS = [
  'packages/apack-sdk/src/services',
  'packages/apack-sdk/src/repositories',
  'packages/apack-host/src/services',
  'packages/apack-host/src/database',
];

const FORBIDDEN = /\b(?:Date\.now|setTimeout|setInterval)\s*\(/;
const ALLOW_MARKER = /\/\/\s*clock-boundary-ok:\s*\S/;

function collectTsFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...collectTsFiles(full));
    else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) found.push(full);
  }
  return found.sort();
}

function isCommentLine(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*');
}

describe('clock boundary in SDK and host domain code', () => {
  it('uses engine.now() / Clock instead of bare Date.now(), setTimeout(), or setInterval()', () => {
    const files = MONITORED_DIRS.flatMap((rel) => collectTsFiles(path.join(REPO_ROOT, rel)));
    expect(files.length).toBeGreaterThan(10);

    const violations: string[] = [];
    for (const file of files) {
      const lines = fs.readFileSync(file, 'utf8').split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        if (isCommentLine(line) || !FORBIDDEN.test(line)) continue;
        const prev = i > 0 ? lines[i - 1]! : '';
        if (ALLOW_MARKER.test(line) || ALLOW_MARKER.test(prev)) continue;
        violations.push(`${path.relative(REPO_ROOT, file)}:${i + 1}: ${line.trim()}`);
      }
    }

    expect(
      violations,
      'Use engine.now() / @apackdev/sdk/ears now() or an injected Clock instead of bare Date.now()/setTimeout()/setInterval(), or document an exception with `// clock-boundary-ok: <reason>`',
    ).toEqual([]);
  });
});
