// @slow: the generated scaffold must survive the real authoring toolchain outside the monorepo.
// CLI calls run in owned asynchronous processes so compiler work cannot block Vitest's reporting.
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { extractPackArchive, verifyPack, PACK_LAYOUT } from '@apackdev/host/packs';
import { parse as parseYaml } from 'yaml';
import { typecheckPack } from '../_support/pack-builds';
import { runCommand } from '../_support/run-command.ts';

import { COMMANDS, type Command } from '../../src/command-tree.ts';

/**
 * The scaffold an outside author starts from must build, typecheck and pack as
 * generated. Runs the real CLI in a temp dir outside the monorepo; only the
 * toolchain's node_modules are borrowed from the repo (no Electron).
 */const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const CLI = path.join(REPO_ROOT, 'packages', 'apack-cli', 'bin', 'apack.mjs');

let tmp: string;
let pack: string;
/** What `init` printed: it names scripts, so it is held to the same rule as the files it wrote */
let initOutput: string;


let active: ReturnType<typeof runCommand> | undefined;
let testSignal: AbortSignal | undefined;

beforeEach(async ({ signal }) => {
  await active;
  testSignal = signal;
});

function run(cmd: string, args: string[], cwd: string, timeout = 60_000) {
  return active = runCommand(cmd, args, cwd, { signal: testSignal, timeout });
}

function callCli(cwd: string, command: string, args: string[] = []) {
  // Match the existing full CLI build allowance: captured backend (180s) plus cold frontend (120s).
  return run(process.execPath, [CLI, 'pack', command, ...args], cwd, command === 'build' ? 180_000 + 120_000 : 60_000);
}

beforeAll(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'apack-scaffold-'));
  // produces: the shared demo-pack every test below reads; the code check is a fixture guard
  const init = await callCli(tmp, 'init', ['demo-pack']);
  expect(init.code).toBe(0);
  initOutput = init.output;
  pack = path.join(tmp, 'demo-pack');
  fs.symlinkSync(path.join(REPO_ROOT, 'node_modules'), path.join(pack, 'node_modules'), 'dir');
}, 60_000 + 20_000);

afterAll(async () => {
  // A failed shutdown preserves the fixture rather than deleting files beneath a live toolchain.
  await active;
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('apack pack init → add feature → build → tsc → pack', () => {
  it('scaffolds a pack with a release workflow and no unresolvable dependencies', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(pack, 'apack.json'), 'utf-8'));
    expect(manifest.dependencies).toEqual({});
    const workflow = fs.readFileSync(path.join(pack, '.github', 'workflows', 'release.yml'), 'utf-8');
    // A runner has no installed app, so the build resolves built-in dependencies from a downloaded beta
    expect(workflow).toMatch(/runs-on: macos-14/);
    expect(workflow).toMatch(/APACK_HOST: beta/);
  });

  it("explains instead of writing a flow the scaffold can't build (no dependency provides steps)", async () => {
    // process: the exit code and the message an author reads are the assertion
    const result = await run('node', [CLI, 'pack', 'add', 'flow', 'heartbeat'], pack);
    expect(result.code).not.toBe(0);
    expect(result.output).toMatch(/"dependencies": \{ "default-setup": "\*" \}/);
    expect(fs.existsSync(path.join(pack, 'src', 'content', 'flows', 'heartbeat.ts'))).toBe(false);
  });

  it('rejects a feature id that is not an identifier', async () => {
    // process: the exit code and the message an author reads are the assertion
    const result = await run('node', [CLI, 'pack', 'add', 'feature', 'my-notes'], pack);
    expect(result.code).not.toBe(0);
    expect(result.output).toMatch(/must start with a lowercase letter and contain only letters and digits/);
  });

  it('adds a feature, builds, typechecks and packs a verified archive', async () => {
    // produces: the feature the build below compiles
    expect((await callCli(pack, 'add', ['feature', 'notes', '--description', 'Manage notes.', '--label', 'Notes', '--designation', 'notebook'])).code).toBe(0);
    const manifest = JSON.parse(fs.readFileSync(path.join(pack, 'apack.json'), 'utf-8'));
    expect(manifest.features.notes.types).toBe('src/features/notes/be/types.ts');
    expect(manifest.features.notes.description).toBe('Manage notes.');
    expect(manifest.features.notes.settings.form).toBe('src/features/notes/fe/settings.vue');
    expect(manifest.features.notes.designation).toBe('notebook');
    for (const command of ['validate', 'doctor']) {
      const result = await run(process.execPath, [CLI, 'pack', command], pack);
      expect(result.code, result.output).toBe(0);
    }

    // produces: the dist files and apply JSON asserted just below
    const build = await callCli(pack, 'build');
    expect(build.code, build.output).toBe(0);
    expect(fs.existsSync(path.join(pack, 'dist', 'runtime', 'index.cjs'))).toBe(true);
    expect(fs.existsSync(path.join(pack, 'dist', 'runtime', 'fe.js'))).toBe(true);
    // The scaffold's example entry content the pack's own entity type from markdown
    const examples = JSON.parse(fs.readFileSync(path.join(pack, 'dist', 'runtime', 'content', 'examples.content.json'), 'utf-8'));
    expect(examples.records).toEqual([expect.objectContaining({ entity: 'DemoPack', title: 'Hello', content: expect.stringContaining('hello.md') })]);

    // typecheck: the TypeScript API builds the same program tsc --noEmit would, in this process
    const tsc = await typecheckPack(pack);
    expect(tsc.code, tsc.output).toBe(0);

    const out = path.join(tmp, 'out');
    // produces: the archive extractPackArchive/verifyPack read below
    const packed = await callCli(pack, 'archive', ['--out', out]);
    expect(packed.code, packed.output).toBe(0);
    const extracted = await extractPackArchive(path.join(out, 'demo-pack-0.1.0.tgz'), path.join(tmp, 'extract'));
    expect(verifyPack(extracted).id).toBe('demo-pack');
    const guide = fs.readFileSync(path.join(REPO_ROOT, 'docs/public-facing/pack-builds.md'), 'utf8');
    for (const file of [PACK_LAYOUT.manifest, PACK_LAYOUT.integrity, PACK_LAYOUT.runtimeEntry, PACK_LAYOUT.feEntry, PACK_LAYOUT.snapshot]) {
      expect(fs.existsSync(path.join(extracted, file)), file).toBe(true);
      expect(guide, `Missing public build path ${file}`).toContain('`' + file + '`');
    }

  }, 5 * 60_000 + (180_000 + 120_000) + 20_000);

  /**
   * The facade round trip through the **scripts the scaffold writes**, on a pack scaffolded the way an author
   * gets one: `apack pack init` writes no `etc/`, so a pack's report appears at its first `facade:update`, and
   * what this holds is that the two scripts it ships work in that order on a pack nobody has edited.
   *
   * What the command decides — that it re-bundles the facade rather than reading `dist`, and so needs no
   * build — is `tests/commands/facade-report.integration.spec.ts`, so this runs on the pack the case above
   * built: the cases here share one pack in declaration order.
   */
  it('records the facade dependents compile against, and then reports it up to date', async () => {
    const report = path.join(pack, 'etc', 'pack-types.api.md');
    // Nothing is recorded before the first update: there is no report to be stale against
    expect(fs.existsSync(report)).toBe(false);
    const missing = await callCli(pack, 'facade-report');
    expect(missing.code, missing.output).toBe(1);
    expect(missing.output).toContain("doesn't exist");

    const written = await callCli(pack, 'facade-report', ['--update']);
    expect(written.code, written.output).toBe(0);
    expect(fs.readFileSync(report, 'utf-8')).toContain('Facade types report for the "demo-pack" pack');

    const checked = await callCli(pack, 'facade-report');
    expect(checked.code, checked.output).toBe(0);
    expect(checked.output).toContain('is up to date');
  }, 3 * 60_000 + 20_000);

  /**
   * Every file the scaffold ships that names a command — both workflows and the README — held to the scripts
   * it also ships. A README or a workflow step naming a script that does not exist is the same rot, so one
   * rule reads both.
   *
   * The workflows are **parsed**, not scanned. The first version of this matched `/^\s*- run: /`, which a
   * step written with a `name:` does not begin with — `release.yml`'s tag check is one, so the case was
   * reading 8 of its 9 steps while claiming all of them. Measured before this was fixed: pointing that step
   * at `npm run does-not-exist` left the case green. Parsing also means a malformed template throws here
   * rather than at a pack author's first push.
   */
  it('names only scripts and commands that exist, everywhere the scaffold names one', () => {
    const scripts = Object.keys(JSON.parse(fs.readFileSync(path.join(pack, 'package.json'), 'utf-8')).scripts);
    /** npm subcommands that are npm's own and run no script, so a scaffolded file may name them freely */
    const NOT_A_SCRIPT = ['ci', 'install', 'i'];
    /** The first words that mean "this line runs something", and so must resolve to something that exists */
    const RUNNERS = ['npm', 'npx', 'yarn', 'pnpm', 'bunx', 'apack'];

    /**
     * What a line names and cannot honour, or nothing when it can.
     *
     * The default is to **report**, not to ignore. The version this replaced recognised `npm run x` and
     * `npx apack y` and fell through for everything else, which silently passed `npm nonexistent`,
     * `apack nonexistent` and `yarn run x` — three holes that were one hole, the fall-through. A line whose
     * first word is a runner has to resolve here; a line that is shell (`test "v$(…)"`, `echo`) is not ours.
     */
    const unknown = (line: string): string | undefined => {
      const tokens = line.split(/\s+/);
      const [first = '', second = '', third = ''] = tokens;
      if (!RUNNERS.includes(first)) return undefined;
      // `npm run x`, and npm's lifecycle shorthands, which do run a script of that name
      if (first === 'npm') {
        const script = second === 'run' ? third : ['test', 'start'].includes(second) ? second : undefined;
        if (script !== undefined) return scripts.includes(script) ? undefined : `npm run ${script}`;
        return NOT_A_SCRIPT.includes(second) ? undefined : `npm ${second}`;
      }
      const command = first === 'apack' ? second : second === 'apack' ? third : undefined;
      if (command === undefined) return `${first} ${second}`; // a runner invoking something that is not ours
      const commandIndex = first === 'apack' ? 1 : 2;
      let node: Command | undefined = (COMMANDS as Record<string, Command>)[command];
      let index = commandIndex + 1;
      while (node?.children && tokens[index] && !tokens[index]!.startsWith('-')) node = node.children[tokens[index++]!];
      return node ? undefined : tokens.slice(0, index).join(' ');
    };

    const offenders: string[] = [];
    const judge = (where: string, lines: readonly string[]) => {
      offenders.push(...lines.map((line) => unknown(line.trim())).filter((x): x is string => x !== undefined).map((x) => `${where}: ${x}`));
    };

    for (const name of ['ci.yml', 'release.yml']) {
      const file = path.join(pack, '.github', 'workflows', name);
      expect(fs.existsSync(file), `${name} was not scaffolded`).toBe(true);
      const text = fs.readFileSync(file, 'utf-8');
      // Throws on a malformed template rather than reading nothing out of it
      const workflow = parseYaml(text) as { jobs?: Record<string, { steps?: { run?: string }[] }> };
      const runSteps = Object.values(workflow.jobs ?? {}).flatMap((job) => (job.steps ?? []).filter((step) => typeof step.run === 'string'));
      // Steps against steps, not lines against steps: a multi-line `run: |` block inflates a line count, and
      // the loose comparison this replaced would pass while the walk had missed a whole step. A literal
      // `run:` inside a block scalar's body would fail this — rare, loud, and fixable by adjusting the count
      expect(runSteps.length, `${name}: parsed a different number of run steps than the file has`)
        .toBe((text.match(/^\s*-? ?run:/gm) ?? []).length);
      judge(name, runSteps.flatMap((step) => step.run!.split('\n')));
    }

    const readme = fs.readFileSync(path.join(pack, 'README.md'), 'utf-8');
    const named = [...readme.matchAll(/`((?:npm|npx|apack)(?: [\w:-]+)+)`/g)].map((m) => m[1]!);
    expect(named.length, 'the README names no commands, so this passed over nothing').toBeGreaterThan(0);
    judge('README.md', named);

    // What `init` prints is the first thing an author reads, and it names scripts that can be renamed
    const printed = initOutput.split('\n').map((line) => line.trim()).filter((line) => RUNNERS.includes(line.split(/\s+/)[0] ?? ''));
    expect(printed.length, "init printed no commands, so this passed over nothing").toBeGreaterThan(0);
    judge('init output', printed);

    expect(offenders, 'these name a script or command the scaffold does not provide').toEqual([]);
  });

  it('adds a step (declared, shipped in build/steps.build.mjs) and a service that build', async () => {
    // produces: the step whose manifest entry and bundled build facet are asserted below
    expect((await callCli(pack, 'add', ['step', 'ping'])).code).toBe(0);
    // produces: the service whose manifest and generated files are asserted below
    expect((await callCli(pack, 'add', ['service', 'cache'])).code).toBe(0);
    const manifest = JSON.parse(fs.readFileSync(path.join(pack, 'apack.json'), 'utf-8'));
    expect(manifest.extensions.services).toEqual({ cache: 'src/extensions/services/cache.ts#cacheService' });
    expect(manifest.extensions.steps).toEqual({
      ping: {
        kind: 'step',
        node: { label: 'Ping', defaultLabel: 'Ping' },
        build: { compile: 'src/extensions/steps/ping/build.ts#compile', validate: 'src/extensions/steps/ping/build.ts#validate', getLabel: 'src/extensions/steps/ping/build.ts#getLabel' },
        types: 'src/extensions/steps/ping/types.ts',
        fe: { colorKey: 'indigo', nodeConfig: { icon: 'Box',
          connectionRules: { inputs: -1, outputs: -1 }, category: 'logic', isImplemented: true },
          components: { form: { entry: 'src/extensions/steps/ping/form.vue', load: 'lazy' } } },
      },
    });

    // produces: the build whose steps.build.mjs is imported below
    const build = await callCli(pack, 'build');
    expect(build.code, build.output).toBe(0);
    const stepsBuild = await import(path.join(pack, 'dist', 'build', 'steps.build.mjs'));
    expect(stepsBuild.steps.map((step: { type: string }) => step.type)).toEqual(['ping']);

    // typecheck: as above
    const tsc = await typecheckPack(pack);
    expect(tsc.code, tsc.output).toBe(0);
  }, 3 * 60_000 + (180_000 + 120_000) + 20_000);

  it('regenerates entries when a source file codegen reads changes, not only the manifest', async () => {
    const servicePath = path.join(pack, 'src', 'extensions', 'services', 'cache.ts');
    fs.writeFileSync(servicePath, 'export const cacheService = {};\n');

    // produces: regenerates services.ts, whose content is asserted below
    // Both runs use the actual CLI's conditions; Vitest's development condition is a different input.
    const generate = await run('node', [CLI, 'pack', 'generate-entries'], pack);
    expect(generate.code, generate.output).toBe(0);
    expect(generate.output).not.toMatch(/inputs unchanged/);
    expect(fs.readFileSync(path.join(pack, 'src', '__generated__', 'services.ts'), 'utf-8')).toMatch(/import \{ cacheService as __service_cache \}/);
    // process: the stdout a second, unchanged run prints is the assertion
    expect((await run('node', [CLI, 'pack', 'generate-entries'], pack)).output).toMatch(/inputs unchanged/);
  }, 2 * 60_000 + 20_000);

  it('keeps unit tests runnable after init-tests adds Playwright specs', async () => {
    // produces: the Playwright specs the vitest run below picks up
    expect((await callCli(pack, 'init-tests')).code).toBe(0);
    expect(fs.existsSync(path.join(pack, 'tests', 'e2e', 'smoke.spec.ts'))).toBe(true);

    // inherent: runs a pack's own vitest suite — the nested runner is the thing under test
    // Verbose, because which files ran is the question and the default reporter names none of them off a terminal
    const unit = await run(path.join(REPO_ROOT, 'node_modules', '.bin', 'vitest'), ['run', '--reporter=verbose'], pack);
    expect(unit.code, unit.output).toBe(0);
    expect(unit.output).toMatch(/tests\/demo-pack\.spec\.ts/);
    // The scaffold's content test and the added feature's system test run through the harness
    expect(unit.output).toMatch(/tests\/features\/notes\/be\/system\.spec\.ts/);
    // Matching the control character is the job: this strips ANSI colour from captured output.
    // eslint-disable-next-line no-control-regex
    const unitOutput = unit.output.replace(/\x1b\[[0-9;]*m/g, '');
    expect(unitOutput).toMatch(/Tests\s+\d+ passed/);
    expect(unitOutput).not.toMatch(/failed/);
  }, 2 * 60_000 + 20_000);

  it('refuses to build, pack or generate entries for a manifest the installer would reject', async () => {
    const manifestPath = path.join(pack, 'apack.json');
    const original = fs.readFileSync(manifestPath, 'utf-8');
    const manifest = JSON.parse(original);
    // A feature id becomes a name in generated code, so an underscore is one the installer rejects
    manifest.features = { notes_v2: Object.values(manifest.features)[0] };
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    try {
      for (const args of [['pack', 'build'], ['pack', 'archive', '--out', path.join(tmp, 'invalid-out')], ['pack', 'generate-entries', '--force']]) {
        // process: each command's exit code and message for an invalid manifest is the assertion
        const result = await run('node', [CLI, ...args], pack);
        expect(result.code, args.join(' ')).not.toBe(0);
        expect(result.output).toMatch(/apack\.json is invalid/);
      }
    } finally {
      fs.writeFileSync(manifestPath, original);
    }
  }, 3 * 60_000 + 20_000);

  it('fails the build on an unresolvable dependency', async () => {
    const manifestPath = path.join(pack, 'apack.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    manifest.dependencies = { 'nonexistent-pack': '*' };
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

    // process: the exit code and the unresolved-dependency message are the assertion
    const build = await run('node', [CLI, 'pack', 'build'], pack);
    expect(build.code).not.toBe(0);
    expect(build.output).toMatch(/Unresolved pack dependencies:[\s\S]*nonexistent-pack/);
    // The failed build left the previous one where it was: it assembles `dist` aside and renames it into
    // place, so a reader finds the build before this one rather than nothing
    expect(fs.existsSync(path.join(pack, 'dist', 'runtime', 'index.cjs'))).toBe(true);
    // The incumbent build's captured manifest bytes no longer match, regardless of timestamps.
    // process: the exit code and the message are the assertion
    const packed = await run('node', [CLI, 'pack', 'archive', '--out', path.join(tmp, 'stale-out')], pack);
    expect(packed.code).not.toBe(0);
    // Either the authored inventory or the manifest bytes may be the first differing observation.
    expect([
      'Compiler startup input changed: ["authored-files"]',
      'Compiler startup input changed: ["file","apack.json"]',
    ]).toContain(packed.output.trim());
  }, 2 * 60_000 + 20_000);
});
