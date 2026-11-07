// What `npm run typecheck` runs besides its legs: the prerequisite that regenerates the pack's barrel, and
// the recorded files whose checks are chain steps.
//
// **Not in `typecheck-legs.ts`, though that is where a reader would look first.** That file is one of
// `STEP_TABLES`, where a run finds a step's declaration by its `name:` — so naming a step there that is
// declared elsewhere would point a run at the wrong line.
import path from 'node:path';
import { REPO_ROOT } from '@apackdev/host/build/packages-built';
import { ENSURE } from './typecheck-legs.ts';
import type { TimeoutClass } from './step-timeouts.ts';

export interface TypecheckCommand {
  readonly name: string;
  readonly command: string;
  readonly cwd?: string;
  /** A source derivation can do different work from the chain's built-output check. */
  readonly timeout?: TimeoutClass;
}
const defaultSetupDirectory = path.join(REPO_ROOT, 'packages/default-setup');

/**
 * Codegen, ordered ahead of everything that reads it — the second prerequisite, and the same shape as
 * `packages:ensure`.
 *
 * It writes `packages/default-setup/src/__generated__`, which `typecheck:pack` compiles and the two
 * repo-scope legs walk, so it cannot be one of the concurrent jobs. Ordered, it buys two things: the pack's
 * typecheck stops compiling whatever generated code happened to be on disk, and `facade:check` below can run
 * as a pure reader. Costs a hash comparison in milliseconds when nothing moved, and a measured 1.6s when it
 * did (median of 3, 2026-10-08).
 */
export const CODEGEN = 'generate:entries';
// npm lifecycle metadata is a compiler input: both phases must inherit this coordinator's context.
export const GENERATE_ENTRIES: TypecheckCommand = {
  name: CODEGEN, command: 'node ../apack-cli/bin/apack.mjs pack generate-entries', cwd: defaultSetupDirectory,
};

/**
 * The recorded files' checks, which are chain steps rather than legs and stay that way.
 *
 * **They are borrowed, not moved.** `api:check` as a leg would need five hand-written fields on a table whose
 * point is deriving them, and would drop nine declared inputs — six with nothing to catch it, since the
 * modules deciding what a report says are spawned through npm rather than imported. Borrowing retains
 * chain ownership and cache inputs. A different derivation mode declares its own timeout class.
 *
 * Why they are here at all: `exports:check` and `schema:check` are legs, so a green `npm run typecheck` used
 * to say nothing about the other two recorded files — the trap root `CLAUDE.md` warned about in prose.
 */
export const RECORDED_FILE_CHECKS: readonly TypecheckCommand[] = [
  { name: 'api:check', command: 'npm run api:check' },
  // `--skip-generate`, because `CODEGEN` above has just done it. Without the flag this writes into the pack
  // while the legs read it, which is the one reason it is not a leg itself
  // The chain reads a verified build; standalone typechecking bundles declarations from source.
  { name: 'facade:check', command: 'node ../apack-cli/bin/apack.mjs pack facade-report --skip-generate',
    cwd: defaultSetupDirectory, timeout: 'suite' },
];

/** Both prerequisites, in the order they must run: each writes what every job after it reads */
export const PREREQUISITES = [ENSURE, CODEGEN] as const;
