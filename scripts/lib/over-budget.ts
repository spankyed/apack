/**
 * The tests that passed having spent more CPU than their budget, which are reported and never failed (`DEADLINE_FACTOR`).
 *
 * The pool writes one line per test into its output and the chain reads them back under the step, as it does
 * the slowest tests — a passing step's output is buffered and shown only on failure, so this is how a slow
 * pass reaches anyone. The line is written and parsed here and nowhere else, so the two cannot drift.
 */
import * as path from 'node:path';
import type { ReportedRun } from './spec-durations-reporter.ts';
import type { UnitSuite } from './unit-suites.ts';

export interface OverBudgetPass {
  /** Repo-relative spec path */
  readonly file: string;
  readonly name: string;
  readonly cpuMs: number;
  readonly budgetMs: number;
}

/** The reported passes over their budget, each against its own: the reporter reads a test's `meta.cpuBudgetMs` */
export function overBudgetPasses(reported: ReportedRun, suites: readonly UnitSuite[]): OverBudgetPass[] {
  const dirOf = new Map(suites.map((suite) => [suite.workspace, suite.dir]));
  return reported.modules.flatMap((module) => {
    const dir = dirOf.get(module.project);
    if (dir === undefined) return [];
    const file = path.join('packages', dir, module.file);
    return module.overBudget.map((test) => ({ file, name: test.name, cpuMs: test.cpuMs, budgetMs: test.budgetMs }));
  });
}

const PREFIX = 'over budget:';

/** The line the pool prints for one pass, which `overBudgetLines` reads back */
export const overBudgetLine = (pass: OverBudgetPass): string =>
  `${PREFIX} ${Math.round(pass.cpuMs)}ms CPU of ${pass.budgetMs}ms — ${pass.file} > ${pass.name}`;

// eslint-disable-next-line no-control-regex -- the runners colour their output and this reads it back
const ANSI = /\u001B\[[0-9;]*m/g;

/** The over-budget passes a step's output reports, as the chain prints them under the step */
export function overBudgetLines(output: string): { cpuMs: number; budgetMs: number; test: string }[] {
  const found: { cpuMs: number; budgetMs: number; test: string }[] = [];
  for (const raw of output.replace(ANSI, '').split('\n')) {
    const match = /^over budget: (\d+)ms CPU of (\d+)ms — (.+)$/.exec(raw.trim());
    if (match) found.push({ cpuMs: Number(match[1]), budgetMs: Number(match[2]), test: match[3] });
  }
  return found;
}
