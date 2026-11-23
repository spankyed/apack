// `npm run check:repro` — build everything twice from one input and report any output whose bytes moved.
//
// **Why it matters: the chain caches on these bytes.** A step that only consumes a build stays cached through
// a rebuild from unchanged input, which holds exactly as long as the build is reproducible. When it is not,
// every step declaring that tree goes stale once per build, and the miss reads as an ordinary input change.
// So the population is every tree a build writes that another step reads — the published packages, the pack,
// and the app — and `repro.spec.ts` derives that completeness from the chain rather than from a list here.
//
// **A diagnostic, not a gate, and nothing else asks this question.** The chain's `freshnessSweep` is often
// mistaken for it: that reports a step whose declared inputs moved *after it ran*, which catches a step
// writing under a tree it also declares and says nothing about two builds agreeing. Nothing fires on a
// schedule for reproducibility; this fires when someone types it. Two full builds is the reason it is not a
// merge gate, and the trade is deliberate (`docs/archive/goals/goal-reproducible-builds.md`).
//
// Reach for it after bumping a bundler (esbuild, vite, tsup, tsx), before cutting a release, or when a step
// keeps going stale after it passed. What it gives that a stale-cache symptom cannot is the answer per file:
// the one diagnosis it has already overturned blamed esbuild and one bundle, where this named three files and
// the real cause, `tsc` ordering a union's members by creation.
//
//   npm run check:repro                 # the whole comparison
//   npm run check:repro 2>&1 | tail -20 # the verdict without the build logs
//
// It rebuilds this checkout's outputs and takes the package-build lock, so against a running chain it fails at
// once rather than racing it. Treat its absence from a green chain as saying nothing: no chain run makes this
// claim.
//
import { execFileSync } from 'node:child_process';
import { REPO_ROOT } from '@apackdev/host/build/packages-built';
import { compare, KNOWN_IRREPRODUCIBLE, partition, reproPaths, snapshot } from './lib/repro.ts';

function buildEverything(round: number): void {
  const run = (command: string, args: string[]): void => {
    process.stdout.write(`\n[check:repro] round ${round}: ${command} ${args.join(' ')}\n`);
    execFileSync(command, args, { cwd: REPO_ROOT, stdio: 'inherit' });
  };
  run('npm', ['run', 'packages:build']);
  run('npm', ['run', 'packs:stage']);
  run('npm', ['run', 'build:runtime']);
}

const paths = reproPaths();
process.stdout.write(`[check:repro] comparing ${paths.length} output trees across two builds\n`);

buildEverything(1);
const before = snapshot(paths);
buildEverything(2);
const after = snapshot(paths);

if (before.size === 0) {
  process.stderr.write('\n❌ the first build produced no files under any of the derived output paths, so there '
    + 'was nothing to compare. Check that `npm run packages:build`, `npm run packs:stage` and '
    + '`npm run build:runtime` actually ran.\n');
  process.exit(1);
}

const { failing, known } = partition(compare(before, after));

// Printed whether or not one fired: these are races, so a run where a recorded output happens to agree is
// not evidence it is fixed, and a silent pass would let the reader believe the tree is reproducible when it
// is not. With nothing recorded there is nothing to caveat, so it says so in one line.
const recorded = Object.keys(KNOWN_IRREPRODUCIBLE).sort();
if (recorded.length === 0) {
  process.stdout.write('\nno outputs are recorded as irreproducible, so every difference below is a failure\n');
} else {
  process.stdout.write(`\n${recorded.length} outputs are recorded as irreproducible; ${known.length} differed this run:\n`);
  for (const path of recorded) {
    process.stdout.write(`  ${known.some((d) => d.path === path) ? 'differed' : 'agreed  '}  ${path}\n    ${KNOWN_IRREPRODUCIBLE[path]}\n`);
  }
}

if (failing.length === 0) {
  const caveat = known.length === 0 ? '' : `, bar the ${known.length} recorded above`;
  process.stdout.write(`\n✅ ${before.size - known.length} of ${before.size} built files are identical across two `
    + `builds of the same input${caveat}\n`);
} else {
  process.stderr.write(`\n❌ ${failing.length} of ${before.size} built files did not survive a second build `
    + 'of the same input, and no recorded cause explains them:\n');
  for (const { path, kind } of failing) process.stderr.write(`  ${kind.padEnd(12)} ${path}\n`);
  process.stderr.write('\nA build output that changes without its input is one the chain caches on and cannot '
    + 'trust: every step declaring it goes stale once per build. Find the cause before recording one in '
    + 'KNOWN_IRREPRODUCIBLE. See docs/archive/goals/goal-reproducible-builds.md.\n');
  process.exit(1);
}
