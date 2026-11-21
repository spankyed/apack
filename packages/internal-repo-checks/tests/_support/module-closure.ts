// Which first-party modules an entry script reaches, transitively.
//
// Two checks ask it of two populations — a build unit's build script (`chain-table.spec.ts`) and a chain
// step's npm script (`chain-inputs.spec.ts`) — and the answer has to be the same walk, because the thing
// both are testing is a hand-written input list against a derived one. Two walks that resolved differently
// would make one of them wrong in a way neither could report.
import * as fs from 'node:fs';
import * as path from 'node:path';
import ts from 'typescript';
import { REPO_ROOT, repoRelative } from '@apackdev/host/build/packages-built';

/** The options `scripts/tsconfig.json` compiles these scripts with, so the walk resolves as they do */
const RESOLUTION: ts.CompilerOptions = {
  module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext,
  // How a repo script reaches `@apackdev/host/build/…` at all: the condition names each package's source
  customConditions: ['@apackdev/source'],
  allowImportingTsExtensions: true,
};

/** A module of this repo, as against a dependency or a built copy of one */
export const firstParty = (file: string): boolean =>
  file.startsWith(REPO_ROOT + path.sep) && !file.split(path.sep).includes('node_modules');

/**
 * Every first-party module these entries import, transitively, repo-relative — the entries included.
 *
 * `ts.preProcessFile` rather than a parse: it is TypeScript's own scanner for exactly this question, and it
 * reads `import`, `export … from`, `import()` and `require()` without building a program.
 *
 * `prune` stops the walk at a module rather than filtering it afterwards, which is what keeps an exception
 * table small: a module excused because it cannot change what the work produces excuses what *it* imports
 * for the same reason, and listing those one by one is a table that grows with someone else's imports.
 */
export function closureOf(entries: readonly string[], prune: (file: string) => boolean = () => false): string[] {
  const seen = new Set<string>();
  const queue = [...entries];
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file) || !fs.existsSync(file)) continue;
    seen.add(file);
    if (prune(repoRelative(file))) continue;
    for (const { fileName } of ts.preProcessFile(fs.readFileSync(file, 'utf-8'), true, true).importedFiles) {
      const resolved = ts.resolveModuleName(fileName, file, RESOLUTION, ts.sys).resolvedModule?.resolvedFileName;
      if (resolved !== undefined && firstParty(resolved)) queue.push(resolved);
    }
  }
  return [...seen].map(repoRelative);
}
