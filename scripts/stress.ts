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
import { boundedSpawn } from './lib/bounded-spawn.ts';
import { asNumber, BURNER_CEILING_MS, startBurners } from './lib/measure.ts';

const DEFAULT_COMMAND = ['npm', 'run', 'test:unit:host', '--', '--all'];
const OUTPUT_DIR = path.join(process.cwd(), 'node_modules', '.cache', 'apack-stress');

// Its own flags lead; everything after them is the command, flags and all, so `--all` reaches the command untouched
const argv = process.argv.slice(2);
const own: Record<string, string | undefined> = {};
while (argv[0] === '--runs' || argv[0] === '--busy') {
  const [flag, value] = argv.splice(0, 2);
  own[flag!.slice(2)] = value;
}
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
    if (result.code !== 0) failed += 1;
  }
} finally {
  burners.abort();
}
console.log(failed === 0 ? `stress: every run passed under load` : `stress: ${failed} of ${runs} run(s) failed under load`);
process.exitCode = failed === 0 ? 0 : 1;
