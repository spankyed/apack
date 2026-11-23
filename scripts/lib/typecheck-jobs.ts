import type { BudgetClass } from './step-budgets.ts';

export interface TypecheckCommand {
  readonly name: string;
  readonly command: string;
  readonly cwd?: string;
  readonly budget?: BudgetClass;
}

/** Standalone typechecking also runs the published API report check owned by the chain. */
export const RECORDED_FILE_CHECKS: readonly TypecheckCommand[] = [
  { name: 'api:check', command: 'npm run api:check' },
];
