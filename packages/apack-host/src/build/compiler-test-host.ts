/**
 * Whether this machine may run the native suites — captured runtimes, native fixtures, live watchers — directly.
 *
 * Not on a daily-use Mac: those specs compile and execute fresh native fixtures and runtime copies at new paths,
 * and macOS security-assesses each new executable path. Hundreds per run is the pattern recorded alongside
 * system-wide stalled app launches (`docs/archive/references/evidence/build-input-snapshot-proof.md`, "macOS
 * launch-policy investigation"). Linux has no first-launch assessment, and a GitHub-hosted runner is disposable.
 * On a Mac those suites run in the Linux test container instead (`npm run test:linux`). Ordinary builds, the
 * integration half included, reuse the shared compiler store and run directly.
 *
 * One predicate for the suites' own guard and for the chain, which routes those steps into the container, so
 * the two cannot disagree about where they run.
 */
export const compilerTestsRunHere = (platform: NodeJS.Platform = process.platform, env: NodeJS.ProcessEnv = process.env): boolean =>
  platform !== 'darwin' || (env.GITHUB_ACTIONS === 'true' && env.RUNNER_ENVIRONMENT === 'github-hosted');
