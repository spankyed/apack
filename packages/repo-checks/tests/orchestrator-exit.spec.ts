// A script that captures a child's output and reprints it must not call `process.exit()`.
//
// `process.exit()` abandons whatever stdout has still to flush. Measured: piped, it delivers 64KB of a
// 500KB write, and `@app/default-setup`'s suite output alone is 654KB — so a failing step's captured
// output, the one thing worth reading, is what gets cut. This has now been introduced twice: once in
// `scripts/test-unit.ts`, fixed with a comment explaining it, and then again in `scripts/chain.ts` by
// someone who had read that comment. A third time is a rule, not a review note.
//
// The rule is narrow on purpose. `process.exit()` is fine in a script that printed a line and stops, and
// most of `scripts/` is that. What makes it dangerous is reprinting a captured buffer, and the scripts that
// do that are exactly the ones importing `boundedSpawn` — which is derivable rather than listed.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT } from '@apackdev/host/build/packages-built';

const SCRIPTS = path.join(REPO_ROOT, 'scripts');

const scriptFiles = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return scriptFiles(full);
    return entry.isFile() && /\.(ts|mjs)$/.test(entry.name) ? [full] : [];
  });

/** Code lines only: the two compliant scripts each explain the rule in a comment naming `process.exit()` */
const codeLines = (file: string): string[] =>
  fs.readFileSync(file, 'utf-8').split('\n').map((l) => l.trim()).filter((l) => !l.startsWith('//') && !l.startsWith('*'));

describe('a script that reprints a captured buffer', () => {
  // `scripts/lib/exit-on-epipe.ts` needs no exception here: it calls `process.exit` legitimately, and it
  // does not capture a buffer, so it was never in this set. An exception that never fires is worse than
  // none — the first draft of this check carried one.
  // An import of it, not a mention: a script naming it in a comment captures nothing
  const capturing = scriptFiles(SCRIPTS)
    .filter((file) => codeLines(file).some((line) => /\bfrom\s+['"][^'"]*bounded-spawn(\.ts)?['"]/.test(line)));

  it('there are some, so this check is not vacuous', () => {
    expect(capturing.map((f) => path.relative(REPO_ROOT, f)).sort()).not.toEqual([]);
  });

  it.each(capturing.map((f) => path.relative(REPO_ROOT, f)))('%s sets process.exitCode rather than calling process.exit()', (rel) => {
    const offending = codeLines(path.join(REPO_ROOT, rel))
      .filter((line) => /\bprocess\.exit\s*\(/.test(line));
    expect(offending, 'use `process.exitCode = n` (and return); process.exit() truncates buffered output').toEqual([]);
  });
});
