/** Native-normalized plan fields used by the plan artifact and approval block. */
export interface ParsedPlanInput {
  plan: string;
  planFilePath?: string;
}

/**
 * Claude Code 2.1.301 injects plan/path from disk. Its ExitPlanMode schema marks
 * allowedPrompts unused; displaying that field would invent a permission request.
 * Raw permission responses retain their original input independently of this UI projection.
 */
export function parseExitPlanModeInput(input: unknown): ParsedPlanInput {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { plan: '' };
  const value = input as Record<string, unknown>;
  return {
    plan: typeof value.plan === 'string' ? value.plan : '',
    planFilePath: typeof value.planFilePath === 'string' ? value.planFilePath : undefined,
  };
}

/** Keep the full plan body; the approval block owns scrolling. */
export function buildPlanApprovalContext(parsed: ParsedPlanInput): string {
  return parsed.plan.trim() || '(no plan content provided)';
}
