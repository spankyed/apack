/** Cumulative native cost already incurred before an imported session continues. */
export function importedSessionCost(transcript: readonly Record<string, unknown>[]): number {
  let total = 0;
  for (const row of transcript) {
    if (row.type === 'cost-state' && typeof row.totalCostUSD === 'number'
      && Number.isFinite(row.totalCostUSD) && row.totalCostUSD >= 0) total = Math.max(total, row.totalCostUSD);
  }
  return total;
}
