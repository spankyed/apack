/** Keep transport diagnostics intact while describing an unconfirmed native interaction to the user. */
export function describeClaudeUiProblem(problem: string | undefined, purpose: 'request' | 'decision' = 'request'): string | undefined {
  if (problem !== 'Native UI request timed out') return problem;
  return purpose === 'decision'
    ? 'Claude has not confirmed your decision. Try again when it responds.'
    : 'Claude has not responded yet. You can retry or open the native interface.';
}
