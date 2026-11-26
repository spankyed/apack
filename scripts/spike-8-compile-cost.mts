// Phase 2 #8 Spike — TS 5.9 Compile-Cost Gate Benchmark (`code/commit` & `brain` extrapolated to 49 machines).
//
// Modeled on `apack-state/measure/compile-cost.mts`, capturing `Check time`, `Instantiations`, `Types`, `Memory used`,
// and `Wall time` via `tsc --extendedDiagnostics --noEmit` and `vue-tsc --extendedDiagnostics --noEmit`.
//
// Compares:
//   (A) Monolithic 56-call `commit` vs 7-state decomposed `commit` against real `PackNet` (`#generated/state.ts`)
//   (B) 1x `commit` (7 FE + 3 BE) + 1x `brain` (3 BE) + N in {0, 10, 36, 49} medium machines against real `PackNet`
//       vs current XState baseline (`commit` + `brain` and full `default-setup`)
//   (C) `vue-tsc --noEmit` on a probe `.vue` binding `useState('commit')` + `useState(() => child('history'))` vs
//       existing XState `CommitPanel.vue` + `CommitLogSection.vue`
//
// Usage:
//   npx tsx scripts/spike-8-compile-cost.mts
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { cpus, loadavg } from 'node:os';
import { join, resolve } from 'node:path';

const repoRoot = resolve(import.meta.dirname, '..');
const packRoot = join(repoRoot, 'packages', 'default-setup');
const tscBin = join(repoRoot, 'node_modules', 'typescript', 'bin', 'tsc');
const vueTscBin = join(repoRoot, 'node_modules', '.bin', 'vue-tsc');
const benchRoot = join(packRoot, '.temp', 'spike-8-compile-cost');

interface Metrics {
  readonly ok: boolean;
  readonly checkMs: number;
  readonly wallMs: number;
  readonly instantiations: number;
  readonly types: number;
  readonly memoryMb: number;
  readonly errorSummary?: string;
}

const parseDiag = (out: string, label: string): number =>
  Number(new RegExp(`^${label}:\\s+([\\d.]+)`, 'm').exec(out)?.[1] ?? NaN);

const parseMemoryMb = (out: string): number =>
  Number(/^Memory used:\s+(\d+)K/m.exec(out)?.[1] ?? NaN) / 1024;

function runCheck(bin: string, args: string[], cwd: string): Metrics {
  const execOnce = (): { ok: boolean; wallMs: number; out: string } => {
    const began = process.hrtime.bigint();
    try {
      const out =
        bin === tscBin
          ? execFileSync(process.execPath, [bin, ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
          : execFileSync(bin, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      return { ok: true, wallMs: Number(process.hrtime.bigint() - began) / 1e6, out };
    } catch (error) {
      const err = error as { stdout?: string; stderr?: string };
      return {
        ok: false,
        wallMs: Number(process.hrtime.bigint() - began) / 1e6,
        out: `${err.stdout ?? ''}\n${err.stderr ?? ''}`,
      };
    }
  };

  // Warmup + measured run (matches apack-state/measure/compile-cost.mts)
  const warm = execOnce();
  if (!warm.ok) {
    const lines = warm.out.split('\n').filter((l) => l.includes('error TS')).slice(0, 8).join('\n');
    return {
      ok: false,
      checkMs: parseDiag(warm.out, 'Check time') * 1000,
      wallMs: warm.wallMs,
      instantiations: parseDiag(warm.out, 'Instantiations'),
      types: parseDiag(warm.out, 'Types'),
      memoryMb: parseMemoryMb(warm.out),
      errorSummary: lines || warm.out.slice(0, 400),
    };
  }
  const measured = execOnce();
  return {
    ok: measured.ok,
    checkMs: parseDiag(measured.out, 'Check time') * 1000,
    wallMs: measured.wallMs,
    instantiations: parseDiag(measured.out, 'Instantiations'),
    types: parseDiag(measured.out, 'Types'),
    memoryMb: parseMemoryMb(measured.out),
  };
}

function packCompilerOptions(baseDepthToPack: string) {
  return {
    target: 'ES2024',
    lib: ['ES2024', 'ESNext.Collection', 'ESNext.Iterator', 'ESNext.Promise', 'ESNext.Error', 'ESNext.Disposable', 'DOM', 'DOM.Iterable'],
    module: 'esnext',
    moduleResolution: 'bundler',
    strict: false,
    strictNullChecks: true,
    esModuleInterop: true,
    skipLibCheck: true,
    noEmit: true,
    incremental: false,
    allowImportingTsExtensions: true,
    types: ['node'],
    paths: {
      '#generated/*': [`${baseDepthToPack}/src/__generated__/*`],
      '#features/*': [`${baseDepthToPack}/src/features/*`],
      '#extensions/*': [`${baseDepthToPack}/src/extensions/*`],
    },
  };
}

/** Monolithic single-state `commit` declaring all 55 loads/calls (56 `made` / 54 asks) in one state against real `PackNet`. */
function monolithicCommitSource(): string {
  return `import { given } from '@apackdev/state';
import { state } from '#generated/state.ts';
import type { CommitTrailer, OperationMove, RewriteAction, StartableOperation } from '#features/code/be/types.ts';

type MonoShape = {
  data: {
    directory: string;
    statusRev: number;
    reposRev: number;
    blamePath: string | null;
    trailersMessage: string;
    discardPaths: string[] | null;
    logRev: number;
    rewordHash: string | null;
    branchesRev: number;
    mergeTarget: string | null;
    stashesRev: number;
    worktreesRev: number;
    gitError: string | null;
  };
  calls: {
    diff: { each: { path: string; staged: boolean } };
    diffRefresh: { each: { path: string; staged: boolean } };
    stage: { many: string[] };
    unstage: { many: string[] };
    trustRepository: { many: string };
    trustOwnership: 'many';
    resolveConflict: { many: { path: string; strategy: 'ours' | 'theirs' } };
    markResolved: { many: string };
    resolveAllConflicts: { many: 'ours' | 'theirs' };
    untracked: 'each';
    hunk: { one: { path: string; staged: boolean; hunk: string } };
    speedUp: 'one';
    submodule: { one: string };
    commit: { one: { message: string } };
    amend: { one: { message?: string; evenIfPublished?: boolean } };
    removeTrailer: { many: { message: string; trailer: CommitTrailer } };
    generateMessage: 'many';
    revertFile: { many: string };
    revertFiles: { many: string[] };
    restoreDiscarded: { many: string };
    undoLast: { many: { evenIfPublished?: boolean } };
    rewrite: { many: { hash: string; action: RewriteAction; message?: string; evenIfPublished?: boolean } };
    revertCommit: { many: string };
    reset: { one: string };
    push: 'one';
    pull: 'one';
    checkout: { one: { branchName: string; pull?: boolean } };
    createBranch: { one: string };
    signIn: { one: { host: string; during?: 'push' | 'pull' } };
    moveOperation: { one: OperationMove };
    startOperation: { one: { kind: StartableOperation; target: string } };
    tagPush: { one: string };
    tagDelete: { one: string };
    renameBranch: { many: { name: string; to: string } };
    createTag: { many: { name: string; commit?: string; message?: string } };
    stashFiles: 'each';
    stash: { one: { message?: string; stagedOnly?: boolean; paths?: string[] } };
    stashApply: { many: number };
    stashPop: { many: number };
    stashDrop: { many: number };
    stashClear: 'many';
    worktreeAdd: { one: { path: string; branch?: string; createBranch?: boolean } };
    worktreeRemove: { one: { path: string; force?: boolean } };
    worktreeSwitch: { one: string };
  };
};

type MonoEvent =
  | { type: 'REFRESH' }
  | { type: 'STAGE'; paths: string[] }
  | { type: 'PUSH' }
  | { type: 'STOP_PUSH' }
  | { type: 'RESET'; hash: string };

export const monolithicCommit = state<MonoShape, MonoEvent>()({
  data: {
    directory: given,
    statusRev: 1,
    reposRev: 1,
    blamePath: null,
    trailersMessage: '',
    discardPaths: null,
    logRev: 1,
    rewordHash: null,
    branchesRev: 1,
    mergeTarget: null,
    stashesRev: 1,
    worktreesRev: 1,
    gitError: null,
  },
  loads: (load) => ({
    status: load('code', 'commit.GET_GIT_STATUS', { from: ['statusRev'], done: () => undefined }),
    repositories: load('code', 'commit.LIST_REPOSITORIES', { from: ['reposRev'], done: () => undefined }),
    blame: load('code', 'commit.GET_BLAME', { from: ['blamePath'], args: ({ blamePath }) => (blamePath ? { path: blamePath } : null), done: () => undefined }),
    trailers: load('code', 'commit.READ_TRAILERS', { from: ['trailersMessage'], args: ({ trailersMessage }) => (trailersMessage ? { message: trailersMessage } : null), done: () => undefined }),
    discardPreview: load('code', 'commit.PREVIEW_DISCARD', { from: ['discardPaths'], args: ({ discardPaths }) => (discardPaths ? { paths: discardPaths } : null), done: () => undefined }),
    log: load('code', 'commit.LOG_LIST', { from: ['logRev'], args: () => ({}), done: () => undefined }),
    reword: load('code', 'commit.GET_COMMIT_MESSAGE', { from: ['rewordHash'], args: ({ rewordHash }) => (rewordHash ? { hash: rewordHash } : null), done: () => undefined }),
    branches: load('code', 'commit.GET_ALL_BRANCHES', { from: ['branchesRev'], done: () => undefined }),
    mergePreview: load('code', 'commit.PREVIEW_MERGE', { from: ['mergeTarget'], args: ({ mergeTarget }) => (mergeTarget ? { target: mergeTarget } : null), done: () => undefined }),
    stashes: load('code', 'commit.STASH_LIST', { from: ['stashesRev'], done: () => undefined }),
    worktrees: load('code', 'commit.WORKTREE_LIST', { from: ['worktreesRev'], done: () => undefined }),
  }),
  calls: ({ one, each, many }) => ({
    diff: each('code', 'commit.GET_GIT_DIFF', { args: (_k, i) => i, done: () => undefined }),
    diffRefresh: each('code', 'commit.GET_GIT_DIFF', { args: (_k, i) => i, done: () => undefined }),
    stage: many('code', 'commit.STAGE_FILES', { args: (paths) => ({ paths }), done: () => undefined }),
    unstage: many('code', 'commit.UNSTAGE_FILES', { args: (paths) => ({ paths }), done: () => undefined }),
    trustRepository: many('code', 'commit.TRUST_REPOSITORY', { args: (repository) => ({ repository }), done: () => undefined }),
    trustOwnership: many('code', 'commit.TRUST_OWNERSHIP', { done: () => undefined }),
    resolveConflict: many('code', 'commit.RESOLVE_CONFLICT', { args: (i) => i, done: () => undefined }),
    markResolved: many('code', 'commit.MARK_RESOLVED', { args: (path) => ({ path }), done: () => undefined }),
    resolveAllConflicts: many('code', 'commit.RESOLVE_ALL_CONFLICTS', { args: (strategy) => ({ strategy }), done: () => undefined }),
    untracked: each('code', 'commit.LIST_UNTRACKED', { args: (path) => ({ path }), done: () => undefined }),
    hunk: one('code', 'commit.APPLY_HUNK', { args: (i) => i, done: () => undefined }),
    speedUp: one('code', 'commit.SPEED_UP_STATUS', { done: () => undefined }),
    submodule: one('code', 'commit.UPDATE_SUBMODULE', { args: (path) => ({ path }), done: () => undefined }),
    commit: one('code', 'commit.COMMIT', { args: (i) => i, done: () => undefined }),
    amend: one('code', 'commit.AMEND', { args: (i) => i, done: () => undefined }),
    removeTrailer: many('code', 'commit.REMOVE_TRAILER', { args: (i) => i, done: () => undefined }),
    generateMessage: many('code', 'commit.GENERATE_MESSAGE', { done: () => undefined }),
    revertFile: many('code', 'commit.REVERT_FILE', { args: (path) => ({ path }), done: () => undefined }),
    revertFiles: many('code', 'commit.REVERT_FILES', { args: (paths) => ({ paths }), done: () => undefined }),
    restoreDiscarded: many('code', 'commit.RESTORE_DISCARDED', { args: (id) => ({ id }), done: () => undefined }),
    undoLast: many('code', 'commit.UNDO_LAST', { args: (i) => i, done: () => undefined }),
    rewrite: many('code', 'commit.REWRITE_COMMIT', { args: (i) => i, done: () => undefined }),
    revertCommit: many('code', 'commit.REVERT_COMMIT', { args: (hash) => ({ hash }), done: () => undefined }),
    reset: one('code', 'commit.RESET_TO_COMMIT', { args: (hash) => ({ hash }), done: () => undefined }),
    push: one('code', 'commit.PUBLISH_BRANCH', { done: () => undefined }),
    pull: one('code', 'commit.PULL_BRANCH', { done: () => undefined }),
    checkout: one('code', 'commit.CHECKOUT_BRANCH', { args: (i) => i, done: () => undefined }),
    createBranch: one('code', 'commit.CREATE_BRANCH', { args: (branchName) => ({ branchName }), done: () => undefined }),
    signIn: one('code', 'commit.SET_UP_SIGN_IN', { args: (i) => i, done: () => undefined }),
    moveOperation: one('code', 'commit.MOVE_OPERATION', { args: (move) => ({ move }), done: () => undefined }),
    startOperation: one('code', 'commit.START_OPERATION', { args: (i) => i, done: () => undefined }),
    tagPush: one('code', 'commit.PUSH_TAG', { args: (name) => ({ name }), done: () => undefined }),
    tagDelete: one('code', 'commit.DELETE_TAG', { args: (name) => ({ name }), done: () => undefined }),
    renameBranch: many('code', 'commit.RENAME_BRANCH', { args: (i) => i, done: () => undefined }),
    createTag: many('code', 'commit.CREATE_TAG', { args: (i) => i, done: () => undefined }),
    stashFiles: each('code', 'commit.GET_STASH_CHANGES', { args: (k) => ({ index: Number(k) }), done: () => undefined }),
    stash: one('code', 'commit.STASH_PUSH', { args: (i) => i, done: () => undefined }),
    stashApply: many('code', 'commit.STASH_APPLY', { args: (index) => ({ index }), done: () => undefined }),
    stashPop: many('code', 'commit.STASH_POP', { args: (index) => ({ index }), done: () => undefined }),
    stashDrop: many('code', 'commit.STASH_DROP', { args: (index) => ({ index }), done: () => undefined }),
    stashClear: many('code', 'commit.STASH_CLEAR', { done: () => undefined }),
    worktreeAdd: one('code', 'commit.WORKTREE_ADD', { args: (i) => i, done: () => undefined }),
    worktreeRemove: one('code', 'commit.WORKTREE_REMOVE', { args: (i) => i, done: () => undefined }),
    worktreeSwitch: one('code', 'commit.WORKTREE_SWITCH', { args: (path) => ({ path }), done: () => undefined }),
  }),
  on: {
    REFRESH: (_, { data }) => ({ data: { statusRev: data.statusRev + 1 } }),
    STAGE: ({ paths }, { call }) => { call('stage', paths); },
    PUSH: (_, { call }) => { call('push'); },
    STOP_PUSH: (_, { cancel }) => { cancel('push'); },
    RESET: ({ hash }, { cancel, call }) => { cancel('reset'); call('reset', hash); },
  },
});
`;
}

/** Medium-sized pack machine bound to real `PackNet` (views, loads, calls, answers, nested states). */
function mediumMachineSource(at: number): string {
  return `import { answered, given } from '@apackdev/state';
import { state } from '#generated/state.ts';

type Shape${at} = {
  data: {
    title: string;
    items: Record<string, { label: string; done: boolean }>;
    selected: string | null;
    revision: number;
    problem: string | null;
  };
  states: {
    idle: {};
    editing: {
      data: { draft: string };
      states: { typing: {}; saving: { data: { since: number } } };
    };
  };
  calls: { save: { one: string }; tag: 'each'; batch: { many: string[] } };
};

type Event${at} =
  | { type: 'SELECT'; id: string }
  | { type: 'EDIT'; draft: string }
  | { type: 'TYPE'; text: string }
  | { type: 'SAVE' }
  | { type: 'TAG'; id: string }
  | { type: 'BATCH'; paths: string[] }
  | { type: 'CHANGED' };

type Asks${at} = {
  RENAME: { args: { id: string; label: string }; answer: boolean; refuses: { missing: { id: string } } };
  COUNT: { args: {}; answer: number };
};

export const mediumMachine${at} = state<Shape${at}, Event${at}, Asks${at}>()({
  data: { title: 'feature ${at}', items: {}, selected: null, revision: 0, problem: null },
  initial: 'idle',
  follows: (follow) => ({
    notes: follow('notes', 'recent', {
      from: ['revision'],
      args: () => ({ limit: 10 }),
      updated: (update) => (update.ok ? { data: { title: \`\${update.value.recent.length} notes\` } } : { data: { problem: update.failure.message } }),
    }),
  }),
  loads: (load) => ({
    detail: load('code', 'commit.GET_BLAME', {
      from: ['selected'],
      args: ({ selected }) => (selected ? { path: selected } : null),
      done: (outcome) => (outcome.ok ? undefined : { data: { problem: outcome.failure.message } }),
    }),
  }),
  calls: ({ one, each, many }) => ({
    save: one('code', 'commit.CREATE_BRANCH', {
      args: (branchName) => ({ branchName }),
      done: (outcome) => (outcome.ok ? undefined : { data: { problem: outcome.failure.message } }),
    }),
    tag: each('code', 'commit.LIST_UNTRACKED', {
      args: (path) => ({ path }),
      done: () => undefined,
    }),
    batch: many('code', 'commit.STAGE_FILES', {
      args: (paths) => ({ paths }),
      done: () => undefined,
    }),
  }),
  on: {
    SELECT: ({ id }) => ({ data: { selected: id } }),
    EDIT: ({ draft }) => ({ at: 'editing', data: { draft } }),
    TAG: ({ id }, { call }) => { call('tag', id); },
    BATCH: ({ paths }, { call }) => { call('batch', paths); },
    CHANGED: (_, { data }) => ({ data: { revision: data.revision + 1 } }),
  },
  answers: {
    RENAME: ({ id, label }, { data, refuse }) => {
      if (!data.items[id]) throw refuse('missing', 'Missing item', { id });
      return answered(true, { data: (d) => { d.items[id]!.label = label; } });
    },
    COUNT: (_, { data }) => Object.keys(data.items).length,
  },
  states: {
    idle: {},
    editing: {
      data: { draft: given },
      initial: 'typing',
      states: {
        typing: {
          on: {
            TYPE: ({ text }, { data }) => ({ data: { draft: data.draft + text } }),
            SAVE: (_, { data, call }) => {
              call('save', data.draft);
              return { at: 'editing.saving', data: { since: 0 } };
            },
          },
        },
        saving: { data: { since: given } },
      },
    },
  },
});
`;
}

function formatMetrics(label: string, m: Metrics): string {
  if (!m.ok) {
    return `  ${label.padEnd(42)} FAILED (${m.errorSummary?.split('\n')[0] ?? 'compile error'})`;
  }
  return `  ${label.padEnd(42)} check ${m.checkMs.toFixed(0).padStart(6)} ms  wall ${m.wallMs.toFixed(0).padStart(6)} ms  inst ${String(m.instantiations).padStart(9)}  types ${String(m.types).padStart(7)}  mem ${m.memoryMb.toFixed(0).padStart(4)} MB`;
}

type Grade = 'PASS' | 'WARN' | 'FAIL';

function gradeMax(value: number, pass: number, warn: number): Grade {
  if (Number.isNaN(value)) return 'FAIL';
  if (value <= pass) return 'PASS';
  if (value <= warn) return 'WARN';
  return 'FAIL';
}

function main() {
  if (!existsSync(join(packRoot, 'src', '__generated__', 'state.ts'))) {
    throw new Error('Run `npm run generate:entries -w @app/default-setup` before running this benchmark.');
  }

  const tsVersion = execFileSync(process.execPath, [tscBin, '--version'], { encoding: 'utf8' }).trim();
  const vueTscVersion = execFileSync(vueTscBin, ['--version'], { encoding: 'utf8' }).trim();
  console.log(`Phase 2 #8 Spike — TS 5.9 Compile-Cost Benchmark`);
  console.log(`${new Date().toISOString().slice(0, 10)}, ${cpus()[0]?.model}, node ${process.version}, load ${loadavg()[0]!.toFixed(1)}, tsc ${tsVersion}, vue-tsc ${vueTscVersion}`);
  console.log('');

  rmSync(benchRoot, { recursive: true, force: true });

  try {
    // ── Experiment (A): Monolithic 56-call commit vs 7-state decomposed commit ────────────────────
    console.log('=== (A) Monolithic 56-call `commit` vs 7-state decomposed `commit` (real PackNet) ===');

    const monoDir = join(benchRoot, 'exp-a-mono');
    mkdirSync(monoDir, { recursive: true });
    writeFileSync(join(monoDir, 'monolithic-commit.ts'), monolithicCommitSource());
    writeFileSync(
      join(monoDir, 'tsconfig.json'),
      JSON.stringify({ compilerOptions: packCompilerOptions('../../..'), include: ['./monolithic-commit.ts'] }, null, 2),
    );
    const monoMetrics = runCheck(tscBin, ['-p', join(monoDir, 'tsconfig.json'), '--extendedDiagnostics'], packRoot);
    console.log(formatMetrics('Monolithic 56-call commit (1 state)', monoMetrics));

    const decompDir = join(benchRoot, 'exp-a-decomp');
    mkdirSync(decompDir, { recursive: true });
    writeFileSync(
      join(decompDir, 'tsconfig.json'),
      JSON.stringify(
        {
          compilerOptions: packCompilerOptions('../../..'),
          files: ['../../../tests/spike-8/commit-prototype.ts'],
        },
        null,
        2,
      ),
    );
    const decompMetrics = runCheck(tscBin, ['-p', join(decompDir, 'tsconfig.json'), '--extendedDiagnostics'], packRoot);
    console.log(formatMetrics('Decomposed commit (7 FE + 3 BE)', decompMetrics));
    console.log('');

    // ── Experiment (B): 1x commit + 1x brain + N in {0, 10, 36, 49} vs XState baseline ───────────
    console.log('=== (B) 1x `commit` + 1x `brain` + N medium machines (real PackNet) vs XState baseline ===');

    const xstatePairDir = join(benchRoot, 'exp-b-xstate-pair');
    mkdirSync(xstatePairDir, { recursive: true });
    writeFileSync(
      join(xstatePairDir, 'tsconfig.json'),
      JSON.stringify(
        {
          compilerOptions: packCompilerOptions('../../..'),
          files: [
            '../../../src/features/code/fe/features/commit/state.ts',
            '../../../src/features/code/be/features/commit.ts',
            '../../../src/features/brain/be/system.ts',
            '../../../src/features/brain/be/flow-system.ts',
            '../../../src/features/brain/be/step-system.ts',
          ],
        },
        null,
        2,
      ),
    );
    const xstatePairMetrics = runCheck(tscBin, ['-p', join(xstatePairDir, 'tsconfig.json'), '--extendedDiagnostics'], packRoot);
    console.log(formatMetrics('XState baseline (commit + brain)', xstatePairMetrics));

    const xstateFullDir = join(benchRoot, 'exp-b-xstate-full');
    mkdirSync(xstateFullDir, { recursive: true });
    writeFileSync(
      join(xstateFullDir, 'tsconfig.json'),
      JSON.stringify(
        {
          compilerOptions: packCompilerOptions('../../..'),
          include: ['../../../src/**/*.ts'],
        },
        null,
        2,
      ),
    );
    const xstateFullMetrics = runCheck(tscBin, ['-p', join(xstateFullDir, 'tsconfig.json'), '--extendedDiagnostics'], packRoot);
    console.log(formatMetrics('XState baseline (full default-setup .ts)', xstateFullMetrics));

    const scaleResults = new Map<number, Metrics>();
    for (const n of [0, 10, 36, 49]) {
      const dir = join(benchRoot, `exp-b-n-${n}`);
      mkdirSync(join(dir, 'machines'), { recursive: true });
      for (let i = 0; i < n; i++) {
        writeFileSync(join(dir, 'machines', `m${i}.ts`), mediumMachineSource(i));
      }
      writeFileSync(
        join(dir, 'tsconfig.json'),
        JSON.stringify(
          {
            compilerOptions: packCompilerOptions('../../..'),
            files: [
              '../../../tests/spike-8/commit-prototype.ts',
              '../../../tests/spike-8/brain-prototype.ts',
            ],
            include: n > 0 ? ['./machines/*.ts'] : [],
          },
          null,
          2,
        ),
      );
      const metrics = runCheck(tscBin, ['-p', join(dir, 'tsconfig.json'), '--extendedDiagnostics'], packRoot);
      scaleResults.set(n, metrics);
      const totalMachines = 13 + n;
      console.log(formatMetrics(`@apackdev/state N=${String(n).padStart(2)} (${totalMachines} states total)`, metrics));
    }
    console.log('');

    // ── Experiment (C): vue-tsc --noEmit on CommitPanel + CommitLogSection baseline vs probe ─────
    console.log('=== (C) `vue-tsc --noEmit` on XState Commit Vue components vs `@apackdev/state` Vue probe ===');

    const vueBaseDir = join(benchRoot, 'exp-c-vue-baseline');
    mkdirSync(vueBaseDir, { recursive: true });
    writeFileSync(
      join(vueBaseDir, 'tsconfig.json'),
      JSON.stringify(
        {
          compilerOptions: packCompilerOptions('../../..'),
          files: [
            '../../../src/features/code/fe/features/commit/CommitPanel.vue',
            '../../../src/features/code/fe/features/commit/CommitLogSection.vue',
          ],
        },
        null,
        2,
      ),
    );
    const vueBaseline = runCheck(vueTscBin, ['-p', join(vueBaseDir, 'tsconfig.json'), '--noEmit', '--extendedDiagnostics'], packRoot);
    console.log(formatMetrics('vue-tsc baseline (XState Commit .vue)', vueBaseline));

    const vueProbeDir = join(benchRoot, 'exp-c-vue-probe');
    mkdirSync(vueProbeDir, { recursive: true });
    writeFileSync(
      join(vueProbeDir, 'binding.ts'),
      `import { vueBinding } from '@apackdev/state/vue';
import type { commitState } from '../../../tests/spike-8/commit-prototype.ts';

export const { provide, useState } = vueBinding<{ commit: typeof commitState }>();
`,
    );
    writeFileSync(
      join(vueProbeDir, 'ProbeCommitPanel.vue'),
      `<script setup lang="ts">
import { computed } from 'vue';
import { useState } from './binding.ts';

const { state: commit, send, child } = useState('commit');
const { state: history, send: sendHistory } = useState(() => child('history'));
const { state: remotes, send: sendRemotes } = useState(() => child('remotes'));
const { state: composer, send: sendComposer } = useState(() => child('composer'));

const isStaging = computed(() => commit.value.pending.stage + commit.value.pending.unstage > 0);
const isPushing = computed(() => remotes.value?.pending.push ?? false);
const isResetting = computed(() => history.value?.pending.reset ?? false);
const commits = computed(() => history.value?.data.commitLog ?? []);
const trailers = computed(() => composer.value?.data.trailers ?? []);

function refresh() { send({ type: 'commit.REFRESH_STATUS' }); }
function stageAll() { send({ type: 'commit.STAGE_FILES', paths: ['src/app.ts'] }); }
function push() { sendRemotes({ type: 'PUSH_BRANCH' }); }
function stopPush() { sendRemotes({ type: 'STOP_PUSH' }); }
function commitNow() { sendComposer({ type: 'COMMIT', message: commit.value.data.commitMessage }); }
function resetTo(hash: string) { sendHistory({ type: 'RESET_TO_COMMIT', hash }); }
</script>

<template>
  <div v-if="commit.at === 'open'">
    <header>
      <span>{{ commit.data.directory }} ({{ commit.data.gitBranch }})</span>
      <button :disabled="isStaging" @click="refresh">Refresh</button>
      <button :disabled="isStaging" @click="stageAll">Stage</button>
      <button v-if="!isPushing" @click="push">Push</button>
      <button v-else @click="stopPush">Stop Push</button>
      <button @click="commitNow">Commit ({{ trailers.length }})</button>
    </header>
    <section v-if="history">
      <div v-if="history.data.logPath">File: {{ history.data.logPath }}</div>
      <div v-for="entry in commits" :key="entry.hash">
        <span>{{ entry.subject }}</span>
        <button :disabled="isResetting" @click="resetTo(entry.hash)">Reset</button>
      </div>
    </section>
  </div>
</template>
`,
    );
    writeFileSync(
      join(vueProbeDir, 'tsconfig.json'),
      JSON.stringify(
        {
          compilerOptions: packCompilerOptions('../../..'),
          include: ['./binding.ts', './ProbeCommitPanel.vue'],
        },
        null,
        2,
      ),
    );
    const vueProbe = runCheck(vueTscBin, ['-p', join(vueProbeDir, 'tsconfig.json'), '--noEmit', '--extendedDiagnostics'], packRoot);
    console.log(formatMetrics('vue-tsc probe (@apackdev/state Commit)', vueProbe));
    console.log('');

    // ── Pass / Warn / Fail Scorecard ──────────────────────────────────────────────────────────────
    const n0 = scaleResults.get(0)!;
    const n10 = scaleResults.get(10)!;
    const n36 = scaleResults.get(36)!; // 13 (commit+brain) + 36 medium = 49 total machines!
    const n49 = scaleResults.get(49)!; // 13 (commit+brain) + 49 medium = 62 total machines

    // Marginal slope: N=36->49 vs N=10->36
    const slopeMid = (n36.checkMs - n10.checkMs) / (36 - 10);
    const slopeHigh = (n49.checkMs - n36.checkMs) / (49 - 36);
    const slopeRatio = slopeMid > 0 ? slopeHigh / slopeMid : 1;

    const xstateRatio = xstateFullMetrics.ok && xstateFullMetrics.checkMs > 0
      ? n36.checkMs / xstateFullMetrics.checkMs
      : NaN;
    const vueRatio = vueBaseline.ok && vueBaseline.checkMs > 0
      ? vueProbe.checkMs / vueBaseline.checkMs
      : NaN;

    const rows: Array<{ metric: string; measured: string; threshold: string; grade: Grade }> = [
      {
        metric: 'Ported commit (7 FE + 3 BE) + brain (3 BE) check time (N=0)',
        measured: `${n0.checkMs.toFixed(0)} ms`,
        threshold: 'PASS <= 1,500 ms | WARN <= 3,000 ms',
        grade: n0.ok ? gradeMax(n0.checkMs, 1500, 3000) : 'FAIL',
      },
      {
        metric: '49-machine extrapolated tsc check time (N=36 -> 49 states)',
        measured: `${n36.checkMs.toFixed(0)} ms (${xstateRatio.toFixed(2)}x full XState; N=49 -> 62 states: ${n49.checkMs.toFixed(0)} ms)`,
        threshold: 'PASS <= 4,500 ms (or <= 1.25x XState) | WARN <= 7,500 ms',
        grade: !n36.ok
          ? 'FAIL'
          : (n36.checkMs <= 4500 || xstateRatio <= 1.25)
            ? 'PASS'
            : (n36.checkMs <= 7500 && xstateRatio <= 1.75)
              ? 'WARN'
              : 'FAIL',
      },
      {
        metric: '49-machine Instantiations (N=36; N=49 in parens)',
        measured: `${n36.instantiations.toLocaleString()} (N=49: ${n49.instantiations.toLocaleString()})`,
        threshold: 'PASS <= 1,200,000 | WARN <= 2,500,000',
        grade: n36.ok ? gradeMax(n36.instantiations, 1_200_000, 2_500_000) : 'FAIL',
      },
      {
        metric: '49-machine Types count (N=36; N=49 in parens)',
        measured: `${n36.types.toLocaleString()} (N=49: ${n49.types.toLocaleString()})`,
        threshold: 'PASS <= 300,000 | WARN <= 600,000',
        grade: n36.ok ? gradeMax(n36.types, 300_000, 600_000) : 'FAIL',
      },
      {
        metric: '49-machine Memory used (N=36; N=49 in parens)',
        measured: `${n36.memoryMb.toFixed(0)} MB (N=49: ${n49.memoryMb.toFixed(0)} MB)`,
        threshold: 'PASS <= 750 MB | WARN <= 1,228 MB (1.2 GB)',
        grade: n36.ok ? gradeMax(n36.memoryMb, 750, 1228) : 'FAIL',
      },
      {
        metric: 'Marginal scaling (N=36->49 vs N=10->36 slope)',
        measured: `${slopeRatio.toFixed(2)}x (${slopeHigh.toFixed(1)} ms/state vs ${slopeMid.toFixed(1)} ms/state)`,
        threshold: 'PASS <= 1.15x | WARN <= 1.40x',
        grade: n36.ok && n49.ok ? gradeMax(slopeRatio, 1.15, 1.4) : 'FAIL',
      },
      {
        metric: 'vue-tsc on probe Commit .vue vs XState Commit .vue baseline',
        measured: vueProbe.ok
          ? `${vueProbe.checkMs.toFixed(0)} ms (${vueRatio.toFixed(2)}x baseline ${vueBaseline.checkMs.toFixed(0)} ms)`
          : `ERROR: ${vueProbe.errorSummary}`,
        threshold: 'PASS Clean, <= 1.30x | WARN Clean, <= 1.80x',
        grade: !vueProbe.ok ? 'FAIL' : gradeMax(vueRatio, 1.3, 1.8),
      },
    ];

    console.log('=== Scorecard against Blueprint Pass / Warn / Fail Thresholds ===');
    for (const r of rows) {
      console.log(`  [${r.grade.padEnd(4)}] ${r.metric}`);
      console.log(`         Measured:  ${r.measured}`);
      console.log(`         Threshold: ${r.threshold}`);
    }

    const overall: 'GO' | 'WARN' | 'NO-GO' = rows.some((r) => r.grade === 'FAIL')
      ? 'NO-GO'
      : rows.some((r) => r.grade === 'WARN')
        ? 'WARN'
        : 'GO';
    console.log('');
    console.log(`Compile-Cost Verdict: ${overall}`);
  } finally {
    rmSync(benchRoot, { recursive: true, force: true });
  }
}

main();
