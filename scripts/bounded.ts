/**
 * Runs a command under a wall-clock budget: `tsx scripts/bounded.ts <class> <command> [args...]`.
 *
 * For the npm scripts that invoke a shell script directly. The chain kills a step's process group when it
 * overruns, so a script run *through the chain* is already bounded — but the direct run is the one people
 * and agents actually use, and it had no bound at all. `tests/scripts/test-packaged-authoring.sh` is the
 * worked example: it looks bounded, with `set timeout 120` in its expect block, and is not. That timeout
 * covers a pattern match and not the `wait` that follows, which is how it once hung a machine until three
 * pids were killed by hand.
 *
 * **The budget is a declared class, and these four were the reason Phase 1 of `costs-across-machines.md`
 * was bigger than it looked.** They were seconds, sized "at about four times what the thing costs healthy",
 * which made them this machine's deadlines exactly as `budgetFor` did — and worse, they are *inner* bounds
 * nested inside the chain's outer one, so two of them were already the binding constraint:
 * `test:external-pack:contract` was 90s inside against 144s outside, and `test:packaged-authoring` 240s
 * against 364s. Coarsening only the chain's bound would have left a 90s shell bound killing a slow machine
 * exactly as before.
 *
 * So a step and the script it runs name the same class, and the two bounds agree by construction. The class
 * is still written at the call site, in `package.json`, so it is visible next to what it bounds. A budget
 * nobody would wait for is the same as no budget, which is what keeps the ladder short.
 *
 * **One consequence worth knowing: in a chain run this bound never fires.** The chain's own bound on the
 * same step names the same class and starts first, so it reaches the deadline first and reports the step by
 * name, which is the better message. What this one is for is the *direct* run — `npm run test:packaged-authoring`
 * at a terminal, which the chain is not around to bound and which is the run people and agents actually use.
 * It was deliberately tighter than the chain's before, 90s against 144s, and being tighter is exactly what
 * made it a second machine's problem; equal is the right answer and this is the note saying so, so that
 * nobody tunes one of the pair wondering why the other exists.
 */
import { boundedSpawn } from './lib/bounded-spawn.ts';
// The ladder's own machine, for the kill message: without it this path cannot tell this box from a slower
// one, which is the whole reason the machine is a separate argument from the cost
import { TIMEOUT_CLASSES, timedOutBecause, timeoutMsFor, type TimeoutClass } from './lib/step-timeouts.ts';

const [className, command, ...args] = process.argv.slice(2);

if (!command || className === undefined) {
  process.stderr.write(`usage: tsx scripts/bounded.ts <${TIMEOUT_CLASSES.join('|')}> <command> [args...]\n`);
  process.exitCode = 2;
} else {
  // Refuses an unknown class rather than defaulting to one: a budget is a ceiling, so a confident wrong
  // answer is the permissive one (`step-timeouts.ts`, after `sizeOf`)
  const budgetMs = timeoutMsFor(className);
  const { code, timedOut, stalled } = await boundedSpawn(command, args, budgetMs, { stream: true });
  if (timedOut) {
    // Its own line on stderr: the command's own output ended mid-sentence, so say why. This path has a class
    // and an argv and no step record, so it reports no recorded cost.
    process.stderr.write(`\n${timedOutBecause({
      what: `${command} ${args.join(' ')}`,
      timeout: className as TimeoutClass,
      stalled,
    })}\n`);
  }
  // Not process.exit(): it would drop whatever the child's inherited stdio has still to flush
  process.exitCode = code;
}
