// Rewrites the specifiers whose repair the rules already compute, and reports the rest.
//
//   npm run specifiers:fix            write them
//   npm run specifiers:fix -- --dry   print what would be written
//
// Two offences, because for both the rule returns the string to write rather than only the problem: a relative
// `.js` whose source sibling exists, and an own-module specifier that names no file. Everything else a rule
// reports needs a decision — which typed facade, where a module belongs — and a rewriter guessing at those
// would be writing the architecture (`docs/goals/goal-one-rule-set.md`, Phase 5).
import { applyFixes, type Fix } from './lib/specifier-fixes.ts';
import { jsSpecifierFixes, packOwnModuleFixes, repoRootDir } from './check-import-specifiers.ts';

const dry = process.argv.includes('--dry');
const root = repoRootDir();
const fixes: Fix[] = [...jsSpecifierFixes(), ...packOwnModuleFixes()];

if (fixes.length === 0) {
  console.log('specifiers:fix — nothing to fix');
  process.exit(0);
}

const byFile = Map.groupBy(fixes, (fix) => fix.file);
console.log(`specifiers:fix — ${fixes.length} specifier${fixes.length === 1 ? '' : 's'} in ${byFile.size} file${byFile.size === 1 ? '' : 's'}${dry ? ' (--dry, writing nothing)' : ''}\n`);
for (const [file, found] of [...byFile].sort(([a], [b]) => a.localeCompare(b))) {
  console.log(`  ${file}`);
  for (const { line, specifier, named } of found) {
    console.log(`  ${String(line).padStart(6)}  '${specifier}' -> '${named}'`);
  }
}

if (dry) {
  console.log('\nRun without --dry to write them.');
  process.exit(1);
}

const { written, refused } = applyFixes(root, fixes);
const count = written.reduce((total, { count: n }) => total + n, 0);
console.log(`\nfixed ${count} specifier${count === 1 ? '' : 's'} in ${written.length} file${written.length === 1 ? '' : 's'}`);
if (refused.length > 0) {
  console.error(`\n${refused.length} file${refused.length === 1 ? '' : 's'} left alone:`);
  for (const { file, why } of refused) console.error(`  ${file}: ${why}`);
  process.exit(1);
}
