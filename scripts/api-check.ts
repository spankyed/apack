#!/usr/bin/env node
/**
 * `npm run api:check`: every published package's API reports, regenerated and compared, concurrently.
 *
 * It was `npm run api:check -w @apackdev/ears -w @apackdev/sdk -w @apackdev/ui`, which npm runs **serially**. The
 * three are independent — each compiles its own declarations and extracts its own reports — so the step spent
 * its time one core at a time. Measured 2026-10-05 on a ten-core box, warm `dist`: **12.5s serially against
 * 7.1s together**, for the same 22-23s of CPU. The cores it takes are declared in `POOL_WIDTH`, so the chain
 * admits it against the rest of the budget rather than counting it as one.
 *
 * **It checks and never repairs**, which is the half that cannot change: `api-reports.ts` refuses a stale
 * `dist` rather than building one, because this is a chain step and a step that writes what it declares as an
 * input leaves every later step stale. `npm run api:update` is the fixer and carries `packages:ensure`.
 */
import { packagesBuiltOrRefuse } from '@apackdev/host/build/packages-built';
import { boundedSpawn } from './lib/bounded-spawn.ts';
import { API_CHECK_TIMEOUT, API_REPORT_PACKAGES, apiCheckCommand } from './lib/api-report-packages.ts';
import { TIMEOUT_MS, timedOutBecause } from './lib/step-timeouts.ts';
import { exitOnEpipe } from './lib/exit-on-epipe.ts';

exitOnEpipe();

/**
 * Ahead of the three, so a stale tree costs nothing rather than three compiles.
 *
 * `api-reports.ts` refuses as well, and that is not a second rule — it is the same function called at the
 * other door. Each package's `api:build` runs its own `tsc` *before* `api-reports.ts` loads, so the refusal
 * there arrives after ~2s per package has already been spent; its job is to catch a direct
 * `npm run api:check -w @apackdev/sdk`, which never reaches this file. This one is for the command the chain
 * runs, where the cost is three of those compiles.
 *
 * **A new caller of this is a new freshness door, and the doors are a numbered table**
 * (`packages/apack-testing/CLAUDE.md`) — most of them are npm scripts, and JSON carries no comments, so
 * nothing but that table says a door exists. Copying this line without adding a row is how door 8 arrived
 * unrecorded; no check holds the table, which describes kinds of door rather than call sites.
 */
packagesBuiltOrRefuse('npm run packages:build');

const outcomes = await Promise.all(API_REPORT_PACKAGES.map(async (pkg) => {
  const [command, ...args] = apiCheckCommand(pkg).split(' ');
  const outcome = await boundedSpawn(command!, args, TIMEOUT_MS[API_CHECK_TIMEOUT].ms);
  // One line as each finishes, so three concurrent compilers are not one silence
  process.stdout.write(`  ${outcome.code === 0 ? 'ok  ' : 'FAIL'} ${pkg.padEnd(16)} ${(outcome.ms / 1000).toFixed(1)}s\n`);
  return { pkg, outcome };
}));

// In declared order rather than completion order: progress is what finished, reading wants the list as written
const failed = outcomes.filter(({ outcome }) => outcome.code !== 0);
for (const { pkg, outcome } of failed) {
  const why = outcome.timedOut === true
    ? timedOutBecause({ what: pkg, timeout: API_CHECK_TIMEOUT, stalled: outcome.stalled })
    : `${pkg} failed (exit ${outcome.code})`;
  process.stderr.write(`\n${'─'.repeat(72)}\n${why}\n${'─'.repeat(72)}\n${outcome.output}\n`);
}

if (failed.length > 0) {
  process.stderr.write(`\n❌ ${failed.length} of ${API_REPORT_PACKAGES.length} failed: ${failed.map(({ pkg }) => pkg).join(', ')}\n`);
  process.exitCode = 1;
} else {
  // The one line each run ends on, rather than all of its output: three concurrent extractions buffer npm's
  // preamble and API Extractor's version banner per package, and what a reader wants is the count.
  for (const { outcome } of outcomes) {
    const summary = outcome.output.split('\n').reverse().find((line) => /API reports (?:up to date|updated)$/.test(line));
    if (summary !== undefined) process.stdout.write(`${summary.trim()}\n`);
  }
}
