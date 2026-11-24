/**
 * CC: Goal — set, query, or clear a goal condition on a Claude Code session.
 *
 * When a goal is set the session auto-elevates to bypassPermissions and the
 * goal loop (driven by CC: Turn Completed) keeps sending continuation turns
 * until the model signals GOAL_MET or the 20-iteration cap is hit.
 */

import type { ActionMeta } from '@apackdev/sdk/build';
import type { Services } from '#generated/services.ts';
import {
  getClaudeState,
  persistClaudeState,
  endGoal,
} from './_helpers/thread-context.ts';
import { replayQueuedMessage } from './_helpers/stream-consumer.ts';

export const meta: ActionMeta = {
  label: 'CC: Goal',
  description: 'Set, query, or clear a goal condition on a Claude Code session',
  category: 'claude-code',
  input: {
    command: { type: 'string', required: true },
    text: { type: 'string', required: false },
    threadId: { type: 'string', required: false },
    references: { type: 'object', required: false },
  },
};

const CLEAR_KEYWORDS = new Set(['clear', 'stop', 'off', 'reset', 'none', 'cancel']);
const MAX_CONDITION_LENGTH = 4000;

export async function action(
  params: Record<string, any>,
  services: Services,
) {
  const { text, threadId } = params;
  const args = text?.trim() ? text.trim() : '';

  let result: { text: string; data?: any; skipMessage?: boolean };

  try {
    if (!args) {
      result = handleStatus(services, threadId);
    } else if (CLEAR_KEYWORDS.has(args.split(/\s+/)[0].toLowerCase())) {
      result = handleClear(services, threadId);
    } else {
      result = await handleSet(args, services, threadId);
    }
  } catch (error: any) {
    result = { text: `cc-goal failed: ${error?.message || 'Unknown error'}` };
  }

  if (threadId && !result.skipMessage) {
    services.chat.sendBlockMessage({ threadId, text: result.text, blocks: [] });
  }

  return { success: true, command: 'cc-goal', text: result.text };
}

// ── Status ──────────────────────────────────────────────────────

function handleStatus(
  services: Services,
  threadId?: string,
): { text: string } {
  if (!threadId) return { text: 'No active thread.' };

  const ccState = getClaudeState(services, threadId);
  const goal = ccState?.goal;

  if (!goal) return { text: 'No goal set.' };

  if (goal.status === 'active') {
    return { text: `Goal active (iteration ${goal.iterations}/20): ${goal.condition}` };
  }
  if (goal.status === 'met') {
    return { text: `Goal achieved: ${goal.condition}` };
  }
  return { text: `Goal failed after ${goal.iterations} iterations: ${goal.condition}` };
}

// ── Clear ───────────────────────────────────────────────────────

function handleClear(
  services: Services,
  threadId?: string,
): { text: string } {
  if (!threadId) return { text: 'No active thread.' };

  const ccState = getClaudeState(services, threadId);
  if (!ccState?.goal) return { text: 'No goal to clear.' };

  const condition = ccState.goal.condition;
  endGoal(services, threadId, undefined);
  return { text: `Goal cleared: ${condition}` };
}

// ── Set ─────────────────────────────────────────────────────────

async function handleSet(
  condition: string,
  services: Services,
  threadId?: string,
): Promise<{ text: string; skipMessage?: boolean }> {
  if (!threadId) return { text: 'No active thread — run a Claude Code turn first.' };

  const ccState = getClaudeState(services, threadId);
  if (!ccState?.sessionId) return { text: 'No active session — run a Claude Code turn first.' };
  if (ccState.isRunning) return { text: 'A turn is already running — wait for it to finish.' };
  if (ccState.goal?.status === 'active') return { text: 'A goal is already active. Run /cc-goal clear first.' };
  if (condition.length > MAX_CONDITION_LENGTH) return { text: `Goal condition is limited to ${MAX_CONDITION_LENGTH} characters.` };

  // Persist goal state and auto-elevate permissions
  persistClaudeState(services, threadId, {
    goal: {
      condition,
      setAt: Date.now(),
      status: 'active',
      iterations: 0,
      prevPermissionMode: ccState.permissionMode ?? 'default',
    },
    permissionMode: 'bypassPermissions',
  });

  // Trigger the first turn through the normal chat pipeline
  const initialPrompt = [
    `You have a goal to achieve: "${condition}"`,
    'Work toward this goal. When you believe the goal condition is fully met, say "GOAL_MET" clearly in your response.',
    'Do not ask for confirmation — take action directly.',
  ].join('\n');

  await replayQueuedMessage(
    services,
    threadId as any,
    { text: initialPrompt },
    services.logger,
  );

  return { text: `Goal set: ${condition}`, skipMessage: false };
}
