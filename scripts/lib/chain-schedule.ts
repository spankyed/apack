/**
 * Running a step graph with a lane limit.
 *
 * Separate from `scripts/chain.ts` for the same reason `chain-steps.ts` is: that module runs the chain when
 * imported, so nothing there can be tested. This is the riskiest logic the chain has — a scheduler can
 * deadlock, leak a lane, or keep dispatching after a failure, and none of those show up in a timing run that
 * happens to pass. Here they are a spec with a fake runner.
 */

/** What the scheduler needs of a step; `ChainStep` satisfies it */
export interface SchedulableStep {
  readonly name: string;
  readonly dependsOn: readonly string[];
  /**
   * Steps this one may not run beside, by name — derived from what each writes (`conflictsOf`).
   *
   * Named rather than a boolean: a flag would hold *every* lane, so a step conflicting with one other would
   * block the rest. Where the conflict really is global the set
   * says so, and the scheduler does the same thing for a reason it can print.
   */
  readonly conflicts?: readonly string[];
  /**
   * What of the machine this step takes — `coresFor` (`core-budget.ts`) resolves it from the share that
   * module declares.
   *
   * Absent is one core, which is most steps: a `tsc` leg is one process and nineteen of the chain's steps
   * are one. A resolved number rather than that share, so a case can schedule a graph of weights with no
   * machine behind it, and so this module goes on knowing nothing about pools.
   */
  readonly cores?: number;
  readonly seconds?: number;
}

export interface ScheduleOptions<S extends SchedulableStep> {
  readonly steps: readonly S[];
  /**
   * Cores the steps running together may take, summing their `cores`. One is serial.
   *
   * **The only limit.** A count of steps would meter a single-threaded `tsc` leg and a nine-worker vitest
   * pool as one unit each; measured 2026-10-02, admitting on cores took the chain from a median 202.8s to
   * 169.4s and halved its spread. A budget of one admits the first ready step and nothing beside it, which
   * is the serial diagnostic.
   */
  readonly budget: number;
  /**
   * Asked once a step's needs are met and before it is admitted, so a step that does not run costs no
   * budget. It counts as passed, and the steps that need it become ready.
   */
  readonly skip: (step: S) => boolean;
  /** Runs the step; `false` fails it. A failure stops new dispatches and lets running steps finish. */
  readonly run: (step: S) => Promise<boolean>;
  /**
   * Something outside the graph a step may have to wait for, asked as the step would start, so one that has to wait
   * holds no budget and the rest run past it. `admit` answering false leaves it waiting, asked again after `pause` or
   * when a step ends; a throw fails it. `leave` is told when a step `admit` let in has ended.
   */
  readonly admission?: {
    readonly admit: (step: S) => boolean;
    readonly leave: (step: S) => void;
    readonly pause: () => Promise<void>;
  };
}

export interface ScheduleResult {
  /** The steps that took a lane, in the order they started */
  readonly started: readonly string[];
  /** The steps `skip` answered true for */
  readonly skipped: readonly string[];
  /** The first step to fail, if one did — whether it returned false or threw */
  readonly failed?: string;
  /**
   * What `run` threw, per step. A throw is a bug in the runner rather than a failing check, so it is
   * reported separately instead of being folded into `failed` alone.
   */
  readonly threw: ReadonlyArray<{ readonly step: string; readonly error: unknown }>;
}

/**
 * Runs the graph. A step starts when every step it needs has passed, the budget has room for what it
 * takes, and nothing it conflicts with is running. After a failure nothing new is dispatched and whatever
 * is running is awaited, so the run ends with no orphaned work — and steps that needed the failed one
 * never run, which is why this returns rather than throwing: the caller reports, and the caller decides.
 *
 * **This never throws, including when `run` does.** A rejected `run` escaping the loop would abandon
 * everything else in flight — steps finishing unobserved and the caller dying on an unhandled rejection
 * with child processes alive. A throw is that step failing, so the same draining path applies to it as to
 * a step that returned false.
 */
export async function schedule<S extends SchedulableStep>({ steps, budget, skip, run, admission }: ScheduleOptions<S>): Promise<ScheduleResult> {
  const waiting = new Set(steps.map((step) => step.name));
  const done = new Set<string>();
  const running = new Map<string, Promise<string>>();
  const started: string[] = [];
  const skipped: string[] = [];
  // Not `running`, which holds a step from the moment its promise resolves until the race hands its name
  // back — a window in which a finished step would be recorded as overlapping the next one dispatched
  const live = new Set<string>();
  /** Cores the live steps hold, kept beside `live` so admission is a comparison and not a sum per candidate */
  let spent = 0;
  let failed: string | undefined;
  const threw: { step: string; error: unknown }[] = [];
  /** The steps `skip` has said run, since it is asked once and a step `admit` turns away comes round again */
  const notSkipped = new Set<string>();

  while (waiting.size > 0 || running.size > 0) {
    let turnedAway = false;
    if (failed === undefined) {
      for (const step of steps) {
        if (!waiting.has(step.name)) continue;
        if (!step.dependsOn.every((need) => done.has(need))) continue;
        // A mutex is symmetric: this step may not start beside one it conflicts with, and may not start
        // if a running step names it. Checked both ways rather than trusting the derivation to be
        // symmetric, since a one-sided conflict would silently let the pair overlap.
        const clashes = (name: string): boolean =>
          (step.conflicts ?? []).includes(name)
          || (steps.find((candidate) => candidate.name === name)?.conflicts ?? []).includes(step.name);
        if ([...running.keys()].some(clashes)) continue;
        // `continue`, never `break`: a one-core leg must not wait behind a nine-core pool that happens to
        // sit earlier in the table. A count of steps could `break` safely, because every candidate wanted
        // the same one slot; a budget cannot, because the next candidate may fit where this one does not.
        //
        // **`spent > 0` is what makes the budget soft, and it is not a nicety.** A step wider than the whole
        // budget fits nowhere, so a hard comparison would hold it forever, and this loop exits when nothing
        // is running and nothing was dispatched — the step would never run and the chain would report green
        // over it. One step may always exceed the budget alone; nothing may join it.
        if (spent > 0 && spent + (step.cores ?? 1) > budget) continue;

        if (!notSkipped.has(step.name)) {
          if (skip(step)) {
            waiting.delete(step.name);
            skipped.push(step.name);
            done.add(step.name);
            continue;
          }
          notSkipped.add(step.name);
        }
        try {
          if (admission && !admission.admit(step)) {
            turnedAway = true;
            continue;
          }
        } catch (error) {
          waiting.delete(step.name);
          threw.push({ step: step.name, error });
          failed ??= step.name;
          break;
        }
        waiting.delete(step.name);
        started.push(step.name);
        live.add(step.name);
        spent += step.cores ?? 1;
        const ended = (): void => {
          live.delete(step.name);
          spent -= step.cores ?? 1;
          admission?.leave(step);
        };
        running.set(step.name, run(step).then(
          (passed) => {
            ended();
            if (passed) done.add(step.name);
            else failed ??= step.name;
            return step.name;
          },
          (error: unknown) => {
            ended();
            threw.push({ step: step.name, error });
            failed ??= step.name;
            return step.name;
          },
        ));
      }
    }
    // Nothing running and nothing dispatched means the rest depends on a step that failed, or on nothing
    // this loop can satisfy. Either way there is no one left to wait for.
    const retry = turnedAway && failed === undefined ? admission?.pause() : undefined;
    if (running.size === 0 && retry === undefined) break;
    const finished = await Promise.race<string | void>([...running.values(), ...(retry ? [retry] : [])]);
    if (finished) running.delete(finished);
  }

  return { started, skipped, threw, ...(failed === undefined ? {} : { failed }) };
}
