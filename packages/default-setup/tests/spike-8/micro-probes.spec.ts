import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runProcess } from '@apackdev/sdk/progress';
import { forNet, given, state, system, type Each, type Read } from '@apackdev/state';
import { connect, defectGuard, everyOrder, onSchedule, sample } from '@apackdev/state/testing';
import { vueBinding } from '@apackdev/state/vue';

/**
 * Day-0 fail-fast micro-probes for Phase 2 #8 spike (`code/commit` & `brain` + `runHistory`).
 *
 * Probe 6 (static codebase audit, documented here and in the spike report):
 * - Inspected `src/features/brain/be/system.ts` (`TRIGGER_BRAIN_EVENT` -> `raise(HANDLE_BRAIN_EVENT, { delay: 0 })` at L457-462),
 *   `packages/apack-sdk/src/events/delivery.ts:45-47`, `packages/apack-testing/src/app.ts:296-297`, and every test under
 *   `packages/default-setup/tests/features/brain/`.
 * - Result: ZERO existing brain tests rely on a macrotask delay between `TRIGGER_BRAIN_EVENT` and `HANDLE_BRAIN_EVENT`.
 *   All brain tests await `app.runFlow(...)`, `app.send(...)`, or `app.settle()` (where `settle()` only flushed macrotasks
 *   to wait out XState's `{ delay: 0 }` raise). In `@apackdev/state`, `tell(...)` and `send(...)` are queued post-commit by
 *   the kernel (never re-entrant inside a step), so `{ delay: 0 }` can be dropped cleanly.
 * - Note: `src/features/database/be/system.ts:100` sends `HANDLE_BRAIN_EVENT` directly, so the ported `brain` state should
 *   continue accepting both `TRIGGER_BRAIN_EVENT` and `HANDLE_BRAIN_EVENT` with the same handler.
 */

describe('Phase 2 #8 Spike — Day-0 Fail-Fast Micro-Probes', () => {
  it('Probe 1: same-step cancel(k); call(k, input2) supersedes both `one` and `each` calls under onSchedule', async () => {
    type ProbeNet = {
      systems: {
        git: {
          events: never;
          asks: {
            CHECKOUT: { args: { branch: string }; answer: { branch: string } };
            UNTRACKED: { args: { folder: string; rev: number }; answer: { folder: string; rev: number } };
          };
        };
      };
      surfaces: {};
      views: {};
    };
    const netState = forNet<ProbeNet>();

    const oneOrderings = await everyOrder((schedule) => {
      const guard = defectGuard();
      const be = system({ side: 'backend', ...onSchedule(schedule, 'be'), onDefect: guard.onDefect });
      const fe = system({ side: 'window', ...onSchedule(schedule, 'fe'), onDefect: guard.onDefect });
      const link = connect(fe, be, schedule, 'fe');

      const abortedBranches: string[] = [];
      const seenDoneBranches: string[] = [];

      const gitBe = netState<
        {},
        never,
        ProbeNet['systems']['git']['asks']
      >()({
        answers: {
          CHECKOUT: async ({ branch }, { signal, sleep }) => {
            signal.addEventListener('abort', () => {
              abortedBranches.push(branch);
            });
            await sleep(50);
            return { branch };
          },
          UNTRACKED: async ({ folder, rev }) => ({ folder, rev }),
        },
      });

      const uiFe = netState<
        {
          data: { branch: string | null };
          calls: { checkout: { one: string } };
        },
        { type: 'CHECKOUT'; branch: string }
      >()({
        data: { branch: null },
        calls: ({ one }) => ({
          checkout: one('git', 'CHECKOUT', {
            args: (branch) => ({ branch }),
            done: (outcome) => {
              if (!outcome.ok) return;
              seenDoneBranches.push(outcome.value.branch);
              return { data: { branch: outcome.value.branch } };
            },
          }),
        }),
        on: {
          CHECKOUT: ({ branch }, { cancel, call }) => {
            cancel('checkout');
            call('checkout', branch);
          },
        },
      });

      be.start('git', gitBe);
      const handle = fe.start('ui', uiFe);

      schedule.does(
        'user',
        ['checkout main', () => fe.send(handle, { type: 'CHECKOUT', branch: 'main' })],
        ['supersede checkout feat', () => fe.send(handle, { type: 'CHECKOUT', branch: 'feat' })],
      );

      return () => {
        try {
          const snap = fe.read(handle);
          expect(snap.data.branch).toBe('feat');
          expect(snap.pending.checkout).toBe(false);
          expect(seenDoneBranches.at(-1)).toBe('feat');
          if (abortedBranches.includes('main')) {
            expect(seenDoneBranches).toEqual(['feat']);
          }
        } finally {
          link.close();
          fe.stop();
          be.stop();
          guard.assertNone();
        }
      };
    });

    const eachOrderings = await everyOrder((schedule) => {
      const guard = defectGuard();
      const be = system({ side: 'backend', ...onSchedule(schedule, 'be'), onDefect: guard.onDefect });
      const fe = system({ side: 'window', ...onSchedule(schedule, 'fe'), onDefect: guard.onDefect });
      const link = connect(fe, be, schedule, 'fe');

      const abortedFolders: number[] = [];
      const seenDoneFolders: number[] = [];

      const gitBe = netState<
        {},
        never,
        ProbeNet['systems']['git']['asks']
      >()({
        answers: {
          CHECKOUT: async ({ branch }) => ({ branch }),
          UNTRACKED: async ({ folder, rev }, { signal, sleep }) => {
            signal.addEventListener('abort', () => {
              abortedFolders.push(rev);
            });
            await sleep(50);
            return { folder, rev };
          },
        },
      });

      const uiFe = netState<
        {
          data: { folderRev: number | null };
          calls: { untracked: { each: number } };
        },
        { type: 'REFRESH_FOLDER'; folder: string; rev: number }
      >()({
        data: { folderRev: null },
        calls: ({ each }) => ({
          untracked: each('git', 'UNTRACKED', {
            args: (folder, rev) => ({ folder, rev }),
            done: (outcome) => {
              if (!outcome.ok) return;
              seenDoneFolders.push(outcome.value.rev);
              return { data: { folderRev: outcome.value.rev } };
            },
          }),
        }),
        on: {
          REFRESH_FOLDER: ({ folder, rev }, { cancel, call }) => {
            cancel('untracked', folder);
            call('untracked', folder, rev);
          },
        },
      });

      be.start('git', gitBe);
      const handle = fe.start('ui', uiFe);

      schedule.does(
        'user',
        ['load folder v1', () => fe.send(handle, { type: 'REFRESH_FOLDER', folder: 'src/', rev: 1 })],
        ['supersede folder v2', () => fe.send(handle, { type: 'REFRESH_FOLDER', folder: 'src/', rev: 2 })],
      );

      return () => {
        try {
          const snap = fe.read(handle);
          expect(snap.data.folderRev).toBe(2);
          expect(snap.pending.untracked).toEqual({});
          expect(seenDoneFolders.at(-1)).toBe(2);
          if (abortedFolders.includes(1)) {
            expect(seenDoneFolders).toEqual([2]);
          }
        } finally {
          link.close();
          fe.stop();
          be.stop();
          guard.assertNone();
        }
      };
    });

    expect(oneOrderings).toBeGreaterThan(0);
    expect(eachOrderings).toBeGreaterThan(0);
  });

  it('Probe 2: self-target re-entry `{ at: "running", data }` exits children -> running.onExit -> fresh running.run -> starts new children', async () => {
    const explored = await sample((schedule) => {
      const guard = defectGuard();
      const sys = system({ side: 'backend', ...onSchedule(schedule, 'brain'), onDefect: guard.onDefect });

      const trace: string[] = [];
      let nextRootSeq = 0;

      const stepChild = state<{ data: { id: string } }>()({
        data: { id: given },
        run: ({ data, onExit }) => {
          trace.push(`step.start:${data.id}`);
          onExit(() => {
            trace.push(`step.onExit:${data.id}`);
          });
        },
      });

      const flowChild = state<{
        data: { flowRunId: string; stepIds: string[] };
        starts: { step: Each<typeof stepChild> };
      }>()({
        data: { flowRunId: given, stepIds: given },
        starts: (start) => ({
          step: start(stepChild, { each: 'stepIds', given: (id) => ({ id }) }),
        }),
        run: ({ data, onExit }) => {
          trace.push(`flow.start:${data.flowRunId}`);
          onExit(() => {
            trace.push(`flow.onExit:${data.flowRunId}`);
          });
        },
      });

      const brainRoot = state<
        {
          states: {
            booting: {};
            stopped: {};
            running: {
              data: { generation: number; flowIds: string[] };
              starts: { flow: Each<typeof flowChild> };
            };
          };
        },
        { type: 'RESTART' }
      >()({
        initial: 'booting',
        states: {
          booting: {
            run: () => ({ at: 'running', data: { generation: 1, flowIds: ['root-1'] } }),
          },
          stopped: {},
          running: {
            data: { generation: 1, flowIds: ['root-1'] },
            starts: (start) => ({
              flow: start(flowChild, {
                each: 'flowIds',
                given: (flowRunId) => ({ flowRunId, stepIds: [`step-${flowRunId}`] }),
              }),
            }),
            run: ({ data, onExit }) => {
              const seq = ++nextRootSeq;
              trace.push(`running.run:createRootFlowRunNode(gen=${data.generation},seq=${seq})`);
              onExit(() => {
                trace.push(`running.onExit:stopActive(gen=${data.generation},seq=${seq})`);
              });
            },
            on: {
              RESTART: (_, { data }) => {
                const nextGen = data.generation + 1;
                return {
                  at: 'running',
                  data: { generation: nextGen, flowIds: [`root-${nextGen}`] },
                };
              },
            },
          },
        },
      });

      const handle = sys.start('brain', brainRoot);

      schedule.does('control', ['restart', () => sys.send(handle, { type: 'RESTART' })]);

      return () => {
        try {
          const snap = sys.read(handle);
          expect(snap.at).toBe('running');
          if (snap.at === 'running') {
            expect(snap.data.generation).toBe(2);
            expect(snap.data.flowIds).toEqual(['root-2']);
          }

          // Critical invariant from Blueprint §2 & §3 Probe 2:
          // On self-target re-entry `{ at: 'running', data }`:
          // 1. Existing children (`step`, `flow`) exit FIRST
          // 2. `running.onExit` (`stopActive`) runs SECOND
          // 3. Fresh `running.run` (`createRootFlowRunNode`) runs THIRD
          // 4. New children (`flow`, `step`) start FOURTH
          const idxStepExit1 = trace.indexOf('step.onExit:step-root-1');
          const idxFlowExit1 = trace.indexOf('flow.onExit:root-1');
          const idxRunningExit1 = trace.indexOf('running.onExit:stopActive(gen=1,seq=1)');
          const idxRunningRun2 = trace.indexOf('running.run:createRootFlowRunNode(gen=2,seq=2)');
          const idxFlowStart2 = trace.indexOf('flow.start:root-2');
          const idxStepStart2 = trace.indexOf('step.start:step-root-2');

          expect(idxStepExit1).toBeGreaterThan(-1);
          expect(idxFlowExit1).toBeGreaterThan(-1);
          expect(idxRunningExit1).toBeGreaterThan(-1);
          expect(idxRunningRun2).toBeGreaterThan(-1);
          expect(idxFlowStart2).toBeGreaterThan(-1);
          expect(idxStepStart2).toBeGreaterThan(-1);

          expect(idxStepExit1).toBeLessThan(idxFlowExit1);
          expect(idxFlowExit1).toBeLessThan(idxRunningExit1);
          expect(idxRunningExit1).toBeLessThan(idxRunningRun2);
          expect(idxRunningRun2).toBeLessThan(idxFlowStart2);
          expect(idxFlowStart2).toBeLessThan(idxStepStart2);
        } finally {
          sys.stop();
          guard.assertNone();
        }
      };
    }, { seed: 42, runs: 25 });

    expect(explored.failure).toBeUndefined();
    expect(explored.orderings).toBe(25);
  });

  it('Probe 3: internal scope.send(CHECK_FINISHED) immediately before async run resolves produces 0 defects', async () => {
    const orderings = await everyOrder((schedule) => {
      const guard = defectGuard();
      const sys = system({ side: 'backend', ...onSchedule(schedule, 'statusRefresh'), onDefect: guard.onDefect });

      let checksCompleted = 0;

      const statusRefresh = state<
        {
          data: { next: { count: number } | null; announced: number };
          internal: { type: 'CHECK_FINISHED'; changed: boolean };
          states: {
            idle: {};
            checking: { data: { activeCount: number } };
          };
        },
        { type: 'CHECK' }
      >()({
        data: { next: null, announced: 0 },
        initial: 'idle',
        states: {
          idle: {
            on: {
              CHECK: () => ({ at: 'checking', data: { activeCount: 1 } }),
            },
          },
          checking: {
            data: { activeCount: given },
            run: async ({ send, sleep }) => {
              await sleep(10);
              checksCompleted++;
              send({ type: 'CHECK_FINISHED', changed: true });
            },
            failed: () => ({ at: 'idle', data: { next: null } }),
            on: {
              CHECK: (_, { data }) => ({
                data: { next: { count: (data.next?.count ?? 0) + 1 } },
              }),
            },
            internal: {
              CHECK_FINISHED: ({ changed }, { data }) => {
                const announced = data.announced + (changed ? 1 : 0);
                if (data.next) {
                  return {
                    at: 'checking',
                    data: { activeCount: data.next.count, next: null, announced },
                  };
                }
                return { at: 'idle', data: { announced } };
              },
            },
          },
        },
      });

      const handle = sys.start('statusRefresh', statusRefresh);

      schedule.does(
        'events',
        ['check 1', () => sys.send(handle, { type: 'CHECK' })],
        ['check 2 while checking', () => sys.send(handle, { type: 'CHECK' })],
      );

      return () => {
        try {
          const snap = sys.read(handle);
          expect(snap.at).toBe('idle');
          expect(snap.data.next).toBeNull();
          expect(snap.data.announced).toBe(checksCompleted);
          expect(checksCompleted).toBeGreaterThanOrEqual(1);
          expect(checksCompleted).toBeLessThanOrEqual(2);
        } finally {
          sys.stop();
          guard.assertNone();
        }
      };
    });

    expect(orderings).toBeGreaterThan(0);
  });

  it('Probe 4: Read<T> stays clean on repoId: string + closure-injected runtime with private fields and onExit cleanup', async () => {
    class FakeGitRepository {
      readonly #secretHandle: symbol;
      #fetchCallback: (() => void) | undefined;
      fetchDueClearedCount = 0;

      constructor(readonly path: string) {
        this.#secretHandle = Symbol(path);
      }

      whenFetchDue(cb: (() => void) | undefined): void {
        if (cb === undefined && this.#fetchCallback !== undefined) {
          this.fetchDueClearedCount++;
        }
        this.#fetchCallback = cb;
      }

      triggerFetchDue(): void {
        this.#fetchCallback?.();
      }

      hasCallback(): boolean {
        return this.#fetchCallback !== undefined;
      }

      handleTag(): symbol {
        return this.#secretHandle;
      }
    }

    const repos = new Map<string, FakeGitRepository>();
    const repoA = new FakeGitRepository('/tmp/repo-a');
    const repoB = new FakeGitRepository('/tmp/repo-b');
    repos.set('repo-a', repoA);
    repos.set('repo-b', repoB);

    const repositoryOf = (repoId: Read<string | null>): FakeGitRepository | null =>
      repoId === null ? null : (repos.get(repoId) ?? null);

    using guard = defectGuard();
    const sys = system({ side: 'backend', onDefect: guard.onDefect });
    const fetches: string[] = [];

    const repoWatcher = state<
      {
        data: { repoId: string | null };
        states: {
          none: {};
          attached: { data: { activeRepoId: string } };
        };
      },
      { type: 'ATTACH'; repoId: string | null }
    >()({
      data: { repoId: null },
      initial: 'none',
      on: {
        ATTACH: ({ repoId }) =>
          repoId === null
            ? { at: 'none', data: { repoId: null } }
            : { at: 'attached', data: { repoId, activeRepoId: repoId } },
      },
      states: {
        none: {},
        attached: {
          data: { activeRepoId: given },
          run: ({ data, onExit }) => {
            const repo = repositoryOf(data.activeRepoId);
            if (!repo) return;
            expect(typeof repo.handleTag()).toBe('symbol');
            repo.whenFetchDue(() => {
              fetches.push(repo.path);
            });
            onExit(() => {
              repo.whenFetchDue(undefined);
            });
          },
        },
      },
    });

    const handle = sys.start('commit', repoWatcher);
    sys.send(handle, { type: 'ATTACH', repoId: 'repo-a' });
    expect(repoA.hasCallback()).toBe(true);
    repoA.triggerFetchDue();
    expect(fetches).toEqual(['/tmp/repo-a']);

    sys.send(handle, { type: 'ATTACH', repoId: 'repo-b' });
    expect(repoA.hasCallback()).toBe(false);
    expect(repoA.fetchDueClearedCount).toBe(1);
    expect(repoB.hasCallback()).toBe(true);
    repoB.triggerFetchDue();
    expect(fetches).toEqual(['/tmp/repo-a', '/tmp/repo-b']);

    sys.stop();
    expect(repoB.hasCallback()).toBe(false);
    expect(repoB.fetchDueClearedCount).toBe(1);
    guard.assertNone();
  });

  it('Probe 5: vue-tsc --noEmit cleanly narrows useState(() => child("history")) on a real .vue component', async () => {
    const historyState = state<
      {
        data: { logPath: string | null; commits: { hash: string; subject: string }[] };
        calls: { reset: { one: string } };
      },
      { type: 'CLEAR_FILE_HISTORY' } | { type: 'RESET'; hash: string }
    >()({
      data: { logPath: null, commits: [] },
      calls: () => ({ reset: { kind: 'one', of: 'code', ask: 'commit.RESET_TO_COMMIT', done: () => undefined } as never }),
      on: {
        CLEAR_FILE_HISTORY: () => ({ data: { logPath: null } }),
        RESET: () => undefined,
      },
    });

    const commitRoot = state<
      {
        data: { isShown: boolean };
        states: {
          closed: {};
          open: {
            data: { directory: string };
            starts: { history: typeof historyState };
          };
        };
      },
      { type: 'OPEN'; directory: string }
    >()({
      data: { isShown: true },
      initial: 'closed',
      states: {
        closed: {
          on: { OPEN: ({ directory }) => ({ at: 'open', data: { directory } }) },
        },
        open: {
          data: { directory: given },
          starts: () => ({ history: historyState }),
        },
      },
    });

    const binding = vueBinding<{ commit: typeof commitRoot }>();
    expect(typeof binding.useState).toBe('function');

    // Run real `vue-tsc --noEmit` on a temporary `.vue` file inside the workspace so module resolution finds vue + @apackdev/state
    const packRoot = resolve(import.meta.dirname, '../..');
    const repoRoot = resolve(packRoot, '../..');
    const vueTscBin = join(repoRoot, 'node_modules', '.bin', 'vue-tsc');
    const tempBase = join(packRoot, '.temp');
    mkdirSync(tempBase, { recursive: true });
    const tempDir = mkdtempSync(join(tempBase, 'spike8-vue-probe-'));
    try {
      writeFileSync(
        join(tempDir, 'states.ts'),
        `import { forNet, given } from '@apackdev/state';
import { vueBinding } from '@apackdev/state/vue';

type Net = {
  systems: {
    code: {
      events: never;
      asks: {
        'commit.RESET_TO_COMMIT': { args: { hash: string }; answer: { hash: string } };
      };
    };
  };
  surfaces: {};
  views: {};
};

const s = forNet<Net>();

export const historyState = s<
  {
    data: { logPath: string | null; commits: { hash: string; subject: string }[]; resettingTo: string | null };
    calls: { reset: { one: string } };
  },
  { type: 'CLEAR_FILE_HISTORY' } | { type: 'RESET_TO_COMMIT'; hash: string }
>()({
  data: { logPath: null, commits: [], resettingTo: null },
  calls: ({ one }) => ({
    reset: one('code', 'commit.RESET_TO_COMMIT', {
      args: (hash) => ({ hash }),
      done: () => ({ data: { resettingTo: null } }),
    }),
  }),
  on: {
    CLEAR_FILE_HISTORY: () => ({ data: { logPath: null } }),
    RESET_TO_COMMIT: ({ hash }, { cancel, call }) => {
      cancel('reset');
      call('reset', hash);
      return { data: { resettingTo: hash } };
    },
  },
});

export const commitRoot = s<
  {
    data: { isShown: boolean };
    states: {
      closed: {};
      open: {
        data: { directory: string };
        starts: { history: typeof historyState };
      };
    };
  },
  { type: 'OPEN'; directory: string }
>()({
  data: { isShown: true },
  initial: 'closed',
  states: {
    closed: { on: { OPEN: ({ directory }) => ({ at: 'open', data: { directory } }) } },
    open: {
      data: { directory: given },
      starts: () => ({ history: historyState }),
    },
  },
});

export const { useState } = vueBinding<{ commit: typeof commitRoot }>();
`,
      );

      writeFileSync(
        join(tempDir, 'ProbeLogSection.vue'),
        `<script setup lang="ts">
import { computed } from 'vue';
import { useState } from './states.ts';

const { state: commit, child } = useState('commit');
const { state: history, send: sendHistory } = useState(() => child('history'));

const commits = computed(() => history.value?.data.commits ?? []);
const logPath = computed(() => history.value?.data.logPath ?? null);
const isResetting = computed(() => history.value?.pending.reset ?? false);

function clearHistory() {
  sendHistory({ type: 'CLEAR_FILE_HISTORY' });
}

function resetCommit(hash: string) {
  sendHistory({ type: 'RESET_TO_COMMIT', hash });
}
</script>

<template>
  <section v-if="commit.at === 'open' && history">
    <div v-if="logPath">{{ logPath }}</div>
    <button :disabled="isResetting" @click="clearHistory">Whole history</button>
    <div v-for="entry in commits" :key="entry.hash">
      <span>{{ entry.subject }}</span>
      <button :disabled="history.pending.reset" @click="resetCommit(entry.hash)">Reset</button>
    </div>
  </section>
</template>
`,
      );

      writeFileSync(
        join(tempDir, 'tsconfig.json'),
        JSON.stringify(
          {
            compilerOptions: {
              target: 'ES2024',
              module: 'esnext',
              moduleResolution: 'bundler',
              strict: true,
              noEmit: true,
              skipLibCheck: true,
              allowImportingTsExtensions: true,
              types: [],
            },
            include: ['./states.ts', './ProbeLogSection.vue'],
          },
          null,
          2,
        ),
      );

      const outcome = await runProcess(vueTscBin, ['-p', join(tempDir, 'tsconfig.json'), '--noEmit'], {
        cwd: packRoot,
      });
      if (!outcome.ok) {
        const detail = 'stdout' in outcome.failure ? `${outcome.failure.stdout}\n${outcome.failure.stderr}` : outcome.failure.kind;
        throw new Error(`vue-tsc failed:\n${detail}`);
      }
      expect(outcome.ok).toBe(true);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
