const object = (value: unknown): Record<string, unknown> | undefined => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;

/** Native transcript facts used by each saved-session import route. */
export function importedSessionMetadata(transcript: readonly Record<string, unknown>[]) {
  let totalCostUsd = 0, model = '', startedAt: number | undefined, lastTurnAt: number | undefined;
  const turns = new Set<string>(), tools = new Set<string>();
  for (const [index, row] of transcript.entries()) {
    if (row.type === 'cost-state' && typeof row.totalCostUSD === 'number'
      && Number.isFinite(row.totalCostUSD) && row.totalCostUSD >= 0) totalCostUsd = Math.max(totalCostUsd, row.totalCostUSD);
    if (row.type !== 'user' && row.type !== 'assistant') continue;
    const message = object(row.message);
    const timestamp = typeof row.timestamp === 'string' ? Date.parse(row.timestamp) : Number.NaN;
    if (Number.isFinite(timestamp)) {
      startedAt = Math.min(startedAt ?? timestamp, timestamp);
      lastTurnAt = Math.max(lastTurnAt ?? timestamp, timestamp);
    }
    if (row.type === 'assistant') {
      if (typeof message?.model === 'string' && message.model && !message.model.startsWith('<')) model = message.model;
      if (Array.isArray(message?.content)) for (const block of message.content) {
        const tool = object(block);
        if (tool?.type === 'tool_use' && typeof tool.id === 'string') tools.add(tool.id);
      }
    } else if (row.isMeta !== true && row.isVirtual !== true
      && !(Array.isArray(message?.content) && message.content.some(block => object(block)?.type === 'tool_result'))) {
      turns.add(typeof row.uuid === 'string' ? row.uuid : String(index));
    }
  }
  return { totalCostUsd, model, turns: turns.size, toolCallCount: tools.size,
    ...(startedAt !== undefined ? { startedAt } : {}), ...(lastTurnAt !== undefined ? { lastTurnAt } : {}) };
}
