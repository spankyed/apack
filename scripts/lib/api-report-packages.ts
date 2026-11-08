import type { BudgetClass } from './step-budgets.ts';

/**
 * The published packages whose API reports `npm run api:check` regenerates and compares.
 *
 * One declaration with the command derived from it, rather than three literal commands in the runner — and
 * `API_CHECK_BUDGET` below read by both the runner's kill and the chain step's rung, so the two cannot name
 * different deadlines for the same work.
 *
 * **Not required by `chain-table.spec.ts`'s "the chain runs every recorded file's check", though that looks like
 * the reason.** `reachableText` follows `npm run` one level out of a *script's* text and deliberately not out
 * of the files that script runs, so moving these commands into a module did take the three workspace-scoped
 * keys (`@apackdev/ui:api:check`) out of its invoked set — checked, they are absent. The check passes anyway
 * because the root step is itself named `api:check`, which satisfies it for all three. `TYPECHECK_LEGS` is
 * read there for the case where the names differ; this one is not, and a comment claiming otherwise would be
 * describing a failure that does not happen.
 */
export const API_REPORT_PACKAGES = ['@apackdev/ears', '@apackdev/sdk', '@apackdev/ui', '@apackdev/testing'] as const;

export type ApiReportPackage = (typeof API_REPORT_PACKAGES)[number];

/** How one package's reports are checked, as the command a runner splits and a check parses */
export const apiCheckCommand = (pkg: string): string => `npm run api:check -w ${pkg}`;

/**
 * The deadline class for one package's check, declared here so the chain's step and the runner read the same
 * name — a measurement would be this machine's, where a class is a class anywhere (`step-budgets.ts`).
 */
export const API_CHECK_BUDGET: BudgetClass = 'suite';
