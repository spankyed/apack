import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT } from '@apackdev/host/build/packages-built';
import { loadedByThePools, spawnCallsIn, spawnSitesIn } from '../../../scripts/lib/process-spawns.ts';

/**
 * Which files in the pooled integration and native runs start a subprocess, and how many times.
 *
 * The pool caps itself below one worker per core because half the cores is *faster* than all of them —
 * 48.2s against 52.4s, measured — and because subprocess compilers are what make a suite sensitive to a
 * machine that is already busy. The cap is a proxy: what needs bounding is concurrent processes and what
 * is bounded is test workers, so every spec pays for the ones that spawn. This is what keeps that count
 * from drifting up unnoticed.
 *
 * **It replaced a check that was wrong about its own subject.** That one asked whether a call's argument
 * *text* matched `/\b(tsc|vue-tsc|TSC_VERSIONS)\b/` and whether its callee was in a hand-written list of
 * spawner names, and reported three spawning specs where there are twelve. It missed the spec running
 * `node <CLI> build` twice, because no compiler appears in the argument text; the two that launch a whole
 * nested `vitest run`, for the same reason; the one calling `spawnSync(command, …)` through a variable,
 * where there is nothing to match; and `execFile`, which its list omitted while carrying both other
 * sync/async pairs. The one file it did catch is the cheapest of the twelve.
 *
 * So the question here is what a file *can do*: the names come from its own `child_process` import and a
 * spawn is a call of one of them (`scripts/lib/process-spawns.ts`). Nothing about what is being spawned is
 * read, because the cap is not about compilers specifically — a nested vitest costs more than a `tsc`.
 *
 * **A file is named for holding a call, not for reaching one**, so `_support/pack-builds.ts` appears once
 * rather than fanning out to its importers, most of which want the in-process `callCli` and never spawn.
 */

const loadedByThePool = (): string[] => loadedByThePools(REPO_ROOT);

/**
 * Every spawn the pooled run makes, with why it is a subprocess rather than an in-process call.
 *
 * `calls` is recorded too, because "which files spawn" and "how much spawning" are different questions and
 * the cap is about the second: a sixth `spawnSync` in a file already listed here is exactly the creep this
 * exists to catch, and a file-level list would wave it through.
 */
const INVENTORY: Record<string, { calls: number; why: string }> = {
  'packages/apack-cli/tests/build/fe-bundler-dev-server.integration.spec.ts': { calls: 1,
    why: 'Separate Vite processes scan a live pack while its output is published. The Windows directory-sharing failure does not reproduce in a same-process server; each child owns a private cache and closes with the test' },
  'packages/apack-cli/tests/build/compiler-pe-libraries.native.spec.ts': { calls: 20,
    why: 'MSVC and ordinary loader fixtures prove actual DLL selection, copied-runtime SxS, pre-initialization refusal, OS assemblies and publisher-policy invalidation. Real Node/compiler processes retain their separate runtime proofs; these loader boundaries cannot be proved in-process' },
  'packages/apack-cli/tests/_support/windows-publisher-policy.ts': { calls: 3,
    why: 'The Windows SDK builds signed fixture assemblies with a process-owned test key. A compiled COM cache utility installs and removes only their unique identities; real OS publication and cleanup cannot be replaced by mocks' },
  'packages/apack-cli/tests/build/compiler-elf-libraries.native.spec.ts': { calls: 3,
    why: 'the Linux proofs compile private NAPI/shared-library fixtures; ordinary Node controls establish actual addon and pre-JavaScript runtime library selection before captured ownership and pre-initialization refusal' },
  'packages/apack-cli/tests/_support/native-libraries.ts': { calls: 3,
    why: 'clang/cc compile the native fixtures, and an ordinary Node load is the control for which libraries the OS actually selects; in-process checks cannot establish OS loading or pre-initialization refusal' },
  'packages/apack-cli/tests/build/compiler-native-runtime.native.spec.ts': { calls: 5,
    why: 'the Electron driver must run under Electron to capture and launch its real framework distribution, which Node cannot emulate, and `codesign` verifies a signed copy; the Mach-O cases compile and launch real images, and an ordinary Node load is the default-fallback control, because only the OS loader shows what it selects' },
  'packages/apack-cli/tests/build/compiler-native-launch.native.spec.ts': { calls: 3,
    why: 'outside launch overrides (DYLD_* variables, an image suffix) are honoured by the OS loader alone, so their controls are real processes started with them set; in-process checks cannot establish what the loader selects' },
  'packages/apack-cli/tests/build/build-worker.native.spec.ts': { calls: 7,
    why: 'private worker IPC lifetime and refusal, public shutdown, native preload identity, loader-startup refusal and natural shutdown under signal refusal require their own processes; two OS process-state queries verify inherited subprocess termination' },
  'packages/repo-checks/tests/bounded-spawn.integration.spec.ts': { calls: 1,
    why: 'a separate orchestrator process receives real signals so cancellation proves its whole child tree is reaped without signaling the test worker' },
  'packages/repo-checks/tests/session.integration.spec.ts': { calls: 2,
    why: 'real Git worktrees verify separate files and indexes; the session command runs as a process to verify gate failures and exit codes' },
  'packages/apack-cli/tests/commands/pack-doctor.integration.spec.ts': { calls: 9,
    why: 'pack doctor and validate as a user runs them: their exit codes and printed diagnostics are the subject, and they must not execute pack source, which only a separate process shows' },
  'packages/apack-cli/tests/commands/info.integration.spec.ts': { calls: 3,
    why: '`pack info --json` and `pack doctor --json` through argv dispatch, whose printed JSON and exit codes are what the spec reads' },
  'packages/apack-cli/tests/build/dependency-graph.integration.spec.ts': { calls: 1,
    why: 'a build refused for a dependency clash, checked through the real process\'s exit code and output' },
  'packages/apack-cli/tests/build/tool-identity.integration.spec.ts': { calls: 2,
    why: 'a copied packaged CLI is the subject: its helper chunk is edited between runs, which only separate processes loading that copy can observe' },
  'packages/apack-cli/tests/commands/scaffold.integration.spec.ts': { calls: 1,
    why: 'the scaffolded pack\'s own toolchain — the CLI bin and then its vitest — run as a pack author runs them, through the test-signal wrapper around runCommand' },
  'packages/apack-cli/tests/build/types-bundler-determinism.integration.spec.ts': { calls: 1,
    why: 'two `apack pack build` runs whose outputs are compared, and two builds sharing one process would share its module state — which is the thing under test' },
  'packages/apack-cli/tests/commands/add-extensions.integration.spec.ts': { calls: 1,
    why: 'vue-tsc, which needs the Vue language service that ts.createProgram is not; its two plain tsc spawns became the in-process typecheckPack' },
  'packages/apack-cli/tests/commands/app-install.integration.spec.ts': { calls: 1,
    why: 'macOS ditto creates real release-style ZIPs so installation verifies native extraction, executable permissions and bundle symlinks' },
  'packages/apack-cli/tests/commands/db.integration.spec.ts': { calls: 3,
    why: 'the CLI\'s db command against a data dir: it opens LMDB and exits, and neither survives being run in the worker; '
      + 'and a process holding the database open to write, as a running app does, which one process can\'t be to itself' },
  'packages/apack-cli/tests/commands/release.integration.spec.ts': { calls: 1,
    why: 'git, in a throwaway repository' },
  'packages/apack-cli/tests/_support/run-command.ts': { calls: 1,
    why: 'the runner for process trees: the CLI and nested vitest, started off the worker\'s event loop with their process group stopped however they end' },
  'packages/apack-cli/tests/harness/dependency-runtime.integration.spec.ts': { calls: 1,
    why: 'a nested `vitest run`: the harness under test is what launches a run, so it cannot be the run that is launching it' },
  'packages/apack-cli/tests/harness/harness-setup.integration.spec.ts': { calls: 1,
    why: 'a nested `vitest run`, for the same reason — and the one whose spawner reaches the binary through a variable' },
  'packages/publish-checks/tests/published-exports.integration.spec.ts': { calls: 1,
    why: 'CONSUMER_MATRIX compiles a consumer with each supported TypeScript, and the subprocess is the fidelity: running the 5.7 floor in-process would put two typescript instances in one process' },
  'packages/publish-checks/tests/published-sdk-types.integration.spec.ts': { calls: 2,
    why: 'node -e inside the consumer directory, so import.meta.resolve and the dynamic imports answer with the consumer\'s resolution and not this process\'s' },
  'packages/repo-checks/tests/_support/repo-files.ts': { calls: 1,
    why: 'git is the only thing that knows what is tracked, and tracked-ness is the subject: a walk of the '
      + 'tree cannot tell a committed file from a build output, which is the distinction every repo-wide '
      + 'guard reading this rests on. One call, shared by every spec that asks' },
  'packages/repo-checks/tests/component-contracts.integration.spec.ts': { calls: 1,
    why: 'vue-tsc again, and it emits declarations for the component reports rather than only checking them' },
  'packages/repo-checks/tests/import-specifiers-script.integration.spec.ts': { calls: 2,
    why: 'check-import-specifiers run through tsx as a process, which is the thing the spec is about' },
};

describe('a subprocess in the integration pool is one that has to be', () => {
  const loaded = loadedByThePool();

  it('reads a real population, so the cases below are about something', () => {
    expect(loaded.length, 'nothing was loaded, so every case here is vacuous').toBeGreaterThan(10);
    expect(loaded.some((file) => file.includes(`_support${path.sep}`)),
      'no support module was reached, so the import walk found nothing and a spawn behind one would be invisible').toBe(true);
  });

  it('names every spawn the pool makes, and how many', () => {
    const found = Object.fromEntries(spawnSitesIn(loaded, REPO_ROOT).map((site) => [site.file, site.count]));
    const expected = Object.fromEntries(Object.entries(INVENTORY).map(([file, { calls }]) => [file, calls]));
    expect(found, 'a new subprocess makes the pooled run slower and more sensitive to a busy machine, and the '
      + 'worker cap is already paying for the ones there are. Make it in-process (typecheckPack, callCli) or '
      + 'record it here with the reason it cannot be').toEqual(expected);
  });

  // An exception naming a file that no longer spawns is text that reads as coverage. Both directions, because
  // a stale entry and a missing one fail differently and only one of them is loud
  it('lists no exception that has stopped applying', () => {
    for (const [file, { why }] of Object.entries(INVENTORY)) {
      expect(fs.existsSync(path.join(REPO_ROOT, file)), file).toBe(true);
      expect(spawnCallsIn(path.join(REPO_ROOT, file)).length, `${file} no longer spawns — drop its entry`).toBeGreaterThan(0);
      expect(why.length, `${file} needs a reason, not a name`).toBeGreaterThan(20);
    }
  });

  /**
   * The mutation, on the **input**. Its predecessor doctored the *expectation* — comparing the real answer
   * against `Object.keys(INVENTORY).slice(1)`, three entries against two — which is arithmetic that holds
   * whatever the detector does: it passed with the detector stubbed to return nothing.
   */
  it('fails when a file that spawns is dropped from the population', () => {
    const dropped = 'packages/apack-cli/tests/_support/run-command.ts';
    const whole = spawnSitesIn(loaded, REPO_ROOT).map((site) => site.file);
    expect(whole, 'the file this drops is not in the answer to begin with, so nothing is being mutated')
      .toContain(dropped);

    const short = loaded.filter((file) => path.relative(REPO_ROOT, file) !== dropped);
    expect(short.length, 'nothing was dropped from the population').toBe(loaded.length - 1);

    // Against its own unmutated answer, not against the inventory: this case is about the answer following the
    // population, and comparing it to the recorded list would make it fire whenever that list is wrong
    expect(spawnSitesIn(short, REPO_ROOT).map((site) => site.file))
      .toEqual(whole.filter((file) => file !== dropped));
  });

  /** The four shapes the text-matching predecessor could not see, and the two it must not read as spawns */
  it.each([
    ['a literal binary', "import { execFileSync } from 'node:child_process';\nexecFileSync(x, ['--noEmit']);", 1],
    ['the binary hoisted to a const', "import { execFileSync } from 'node:child_process';\nconst TSC = j(B, 'tsc');\nexecFileSync(TSC, []);", 1],
    ['an aliased import', "import { execFileSync as sh } from 'node:child_process';\nsh(a, b);", 1],
    ['the async execFile', "import { execFile } from 'node:child_process';\nawait execFile(a, b);", 1],
    ['a promisified execFile bound to a const', "import { execFile } from 'node:child_process';\nimport { promisify } from 'node:util';\nconst run = promisify(execFile);\nawait run(a, b);\nawait run(c, d);", 2],
    ['a promisified execFile called inline', "import { execFile } from 'node:child_process';\nimport { promisify } from 'node:util';\nawait promisify(execFile)(a, b);", 1],
    ['the process-tree runner', "import { runCommand } from '../_support/run-command.ts';\nawait runCommand(a, b, c);", 1],
    ['a namespace import', "import * as cp from 'node:child_process';\ncp.spawn(a, b);", 1],
    // The honest version of "a mention is not a spawn": this file has the import, which is the only way to
    // have the capability, and never calls it. Asserting it of a file with no import proves nothing, since
    // nothing past `boundFrom` would run
    ['an import with no call', "import { spawnSync } from 'node:child_process';\nexport const unused = 1;", 0],
    ['a same-named call from elsewhere', "import { spawnSync } from './local.ts';\nspawnSync(a, b);", 0],
  ])('reads %s', (_shape, source, expected) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spawn-shape-'));
    try {
      const file = path.join(dir, 'probe.ts');
      fs.writeFileSync(file, source);
      expect(spawnCallsIn(file)).toHaveLength(expected);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
