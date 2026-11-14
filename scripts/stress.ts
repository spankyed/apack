/**
 * `npm run stress -- [--runs N] [--busy K] [command…]` — runs a command N times while K busy loops hold the
 * machine, and fails if any run fails.
 *
 * **A test that passes only on a quiet machine is a defect.** Every bound in this repo is progress, not the clock,
 * so load can slow a run and never fail one; this is the check that the claim holds. It is what proves a timing fix
 * — a race that shows only under load passes on a quiet box whatever the fix did — and what finds the next one.
 * Go's `stress` tool is the same shape: one command, repeated under contention, the first failure kept.
 *
 * The default command is the host unit pool over every project. Each run's output is kept under
 * `node_modules/.cache/apack-stress/`, and a failure names its file. Never cached and never a chain step: its result
 * is a property of this machine under this load, not of the inputs.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { stripVTControlCharacters } from 'node:util';
import { boundedSpawn } from './lib/bounded-spawn.ts';
import { asNumber, BURNER_CEILING_MS, startBurners } from './lib/measure.ts';

/** How many of a failed run's last lines to print when its output names no failure of its own */
const TAIL_LINES = 40;

/**
 * What a failed run says went wrong: the lines naming a failing case, an error or a stalled or spent bound, and
 * the end of its output when none does, with terminal colours removed.
 */
function failureOf(output: string): string[] {
  const lines = stripVTControlCharacters(output).split('\n');
  const named = lines.filter((line) => /(^| )(FAIL|×) |Error:|AssertionError|stalled|CPU budget|failed \(exit/.test(line));
  return (named.length > 0 ? [...new Set(named)] : lines.slice(-TAIL_LINES)).slice(0, TAIL_LINES);
}

const DEFAULT_COMMAND = ['npm', 'run', 'test:unit:host', '--', '--all'];
const OUTPUT_DIR = path.join(process.cwd(), 'node_modules', '.cache', 'apack-stress');

// Its own flags lead; everything after them is the command, flags and all, so `--all` reaches the command untouched
const argv = process.argv.slice(2);
const own: Record<string, string | undefined> = {};
while (argv[0] === '--runs' || argv[0] === '--busy') {
  const [flag, value] = argv.splice(0, 2);
  own[flag!.slice(2)] = value;
}
// A leading flag that is not one of its own is not a command either: run, it fails every time with `spawn
// --help ENOENT`, which reads as N failures under load rather than as a mistyped invocation
const USAGE = 'usage: npm run stress -- [--runs N] [--busy K] [command…]  (default: the host unit pool, --all)';
if (argv[0] === '--help' || argv[0] === '-h') {
  console.log(USAGE);
} else if (argv[0]?.startsWith('-')) {
  console.error(`stress: unknown option ${argv[0]}\n${USAGE}`);
  process.exitCode = 2;
} else {
  process.exitCode = await stress();
}

/** Runs the command under load, returning the exit code this script answers with */
async function stress(): Promise<number> {
  const runs = asNumber(own.runs, 'runs') ?? 3;
  // Half the cores by default: enough contention to stretch every wait, and room left for the command itself
  const busy = asNumber(own.busy, 'busy') ?? Math.max(1, Math.floor(os.availableParallelism() / 2));
  const [command, ...args] = argv.length > 0 ? argv : DEFAULT_COMMAND;

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  console.log(`stress: ${[command, ...args].join(' ')}, ${runs} run(s) under ${busy} busy core(s)`);

  const burners = new AbortController();
  startBurners(busy, burners.signal);
  let failed = 0;
  try {
    for (let run = 1; run <= runs; run += 1) {
      const result = await boundedSpawn(command!, args, BURNER_CEILING_MS);
      const file = path.join(OUTPUT_DIR, `${stamp}-${run}.log`);
      fs.writeFileSync(file, result.output);
      const verdict = result.code === 0 ? 'passed' : `FAILED (exit ${result.code})`;
      console.log(`  run ${run}/${runs}: ${verdict} in ${Math.round(result.ms / 1000)}s — ${path.relative(process.cwd(), file)}`);
      if (result.code !== 0) {
        failed += 1;
        // Said here as well as kept: the file may not outlive the run (a container's is gone when it exits)
        console.log(failureOf(result.output).map((line) => `    ${line}`).join('\n'));
      }
    }
  } finally {
    burners.abort();
  }
  console.log(failed === 0 ? `stress: every run passed under load` : `stress: ${failed} of ${runs} run(s) failed under load`);
  return failed === 0 ? 0 : 1;
}
