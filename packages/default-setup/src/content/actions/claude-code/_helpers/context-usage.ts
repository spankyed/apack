import type { Services, EntityId } from '#generated/services.ts';

import { getClaudeState, updateClaudeState } from './thread-context.ts';

type NativeContextUsage = Awaited<ReturnType<Services['cli']['claudeCode']['getContextUsage']>>;

export interface ContextUsageData {
  model: string;
  totalTokens: number;
  maxTokens: number;
  percentage: number;
  categories: Array<{ name: string; tokens: number; percentage: number }>;
  memoryFiles?: Array<{ type: string; path: string; tokens: number }>;
  skills?: Array<{ name: string; source: string; tokens: number }>;
}

/** Present native usage in the context block; reserved and free space are not used tokens. */
export function toContextUsageData(usage: NativeContextUsage): ContextUsageData {
  return {
    model: usage.model, totalTokens: usage.totalTokens, maxTokens: usage.maxTokens,
    percentage: usage.percentage,
    categories: usage.categories.filter(category => category.kind !== 'free' && category.kind !== 'buffer')
      .map(category => ({ name: category.name, tokens: category.tokens,
        percentage: category.tokens / usage.maxTokens * 100 })),
    memoryFiles: usage.memoryFiles,
    skills: usage.skills?.skillFrontmatter,
  };
}

export async function readThreadContextUsage(
  services: Services,
  threadId: string,
  session: { sessionId?: string; cwd?: string },
): Promise<ContextUsageData | undefined> {
  const handle = services.cli.claudeCode.getHandle(threadId);
  if (handle) return toContextUsageData(await handle.getContextUsage());
  if (!session.sessionId) return undefined;
  return toContextUsageData(await services.cli.claudeCode.getContextUsage({
    sessionId: session.sessionId, cwd: session.cwd,
  }));
}

const CONTEXT_THRESHOLDS = [25, 50, 75, 90];

/** Publish a summary only while it still belongs to the thread's current session. */
export async function refreshThreadContextUsage(
  services: Services,
  threadId: EntityId,
  session: { sessionId: string; cwd?: string },
): Promise<void> {
  const contextUsage = await readThreadContextUsage(services, threadId, session);
  if (!contextUsage) return;
  const current = getClaudeState(services, threadId);
  if (current?.sessionId !== session.sessionId) return;
  const alerted = current.alertedThresholds ?? [];
  const newAlerts = CONTEXT_THRESHOLDS.filter(threshold => contextUsage.percentage >= threshold && !alerted.includes(threshold));
  updateClaudeState(services, threadId, previous => ({
    contextUsage,
    ...(newAlerts.length > 0 ? { alertedThresholds: [...(previous.alertedThresholds ?? []), ...newAlerts] } : {}),
  }));
  if (newAlerts.length === 0) return;
  const highest = Math.max(...newAlerts);
  const variant = highest >= 90 ? 'error' : highest >= 75 ? 'warning' : 'info';
  const label = highest >= 90 ? 'Context Critical' : 'Context Usage';
  let message = `Context window is ${contextUsage.percentage}% full (${fmtTokens(contextUsage.totalTokens)} / ${fmtTokens(contextUsage.maxTokens)} tokens).`;
  if (highest >= 90) message += ' Consider starting a new session soon.';
  services.chat.sendBlockMessage({
    threadId, text: message, blocks: [{ type: 'note', props: { content: message, variant, label } }], forkable: false,
  });
}

function fmtTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}k`;
  return String(tokens);
}
