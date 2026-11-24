/**
 * CDX: Run Command - dispatcher for lightweight cdx- commands.
 */

import type { ActionMeta } from '@apackdev/sdk/build';
import type { EntityId, Services } from '#generated/services.ts';
import { getCodexState, persistCodexState, updateChatState } from './_helpers/thread-context.ts';

export const meta: ActionMeta = {
  label: 'CDX: Run Command',
  description: 'Unified dispatcher for cdx- prefixed chat commands.',
  category: 'codex',
  input: {
    command: { type: 'string', description: 'Full command name (e.g. cdx-status)', required: true },
    text: { type: 'string', description: 'Arguments after the command', required: false },
    threadId: { type: 'string', description: 'Thread ID for response', required: false },
    references: { type: 'object', description: 'Attached references', required: false },
  },
};

type CommandResult = { text: string; data?: any; blocks?: any[]; skipMessage?: boolean };
type Handler = (args: string[], services: Services, threadId?: string) => Promise<CommandResult>;

const handlers: Record<string, Handler> = {
  status: handleStatus,
  model: handleModel,
  models: handleModels,
  config: handleConfig,
  context: handleContext,
  rename: handleRename,
  skills: handleSkills,
  mcp: handleMcp,
  bypass: handleBypass,
  goal: handleGoal,
};

export async function action(
  params: Record<string, any>,
  services: Services,
) {
  const { command, text, threadId } = params;
  const name = (command as string).replace(/^cdx-/, '');
  const args = text?.trim() ? text.trim().split(/\s+/) : [];
  const handler = handlers[name];

  let result: CommandResult;
  if (handler) {
    try {
      result = await handler(args, services, threadId);
    } catch (error: any) {
      result = { text: `cdx-${name} failed: ${error?.message || 'Unknown error'}` };
    }
  } else {
    const available = Object.keys(handlers).map(k => `cdx-${k}`).join(', ');
    result = { text: `Unknown command: cdx-${name}\nAvailable: ${available}` };
  }

  if (threadId && !result.skipMessage) {
    services.chat.sendBlockMessage({
      threadId,
      text: result.text,
      blocks: result.blocks ?? [],
    });
  }

  return { success: !!handler, command: `cdx-${name}`, text: result.text, data: result.data };
}

async function ensureServer(services: Services): Promise<any> {
  const codex = services.codex as any;
  if (codex.status !== 'ready') await codex.start();
  return codex;
}

function effectiveCwd(services: Services, threadId?: string): string | undefined {
  const state = threadId ? getCodexState(services, threadId) : undefined;
  const codeSettings = services.settings.get({ kind: 'feature', featureRef: 'default-setup/code' }) as any;
  return state?.cwdOverride
    || state?.cwd
    || codeSettings?.defaultBaseDirectory
    || codeSettings?.baseDirectory
    || undefined;
}

function getPath(obj: any, path: string): any {
  return path.split('.').reduce((value, segment) => value == null ? undefined : value[segment], obj);
}

function parseValue(raw: string): any {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function display(value: any): string {
  if (value === undefined) return '(unset)';
  if (typeof value === 'string') return value;
  return JSON.stringify(value, null, 2);
}

async function handleStatus(
  _args: string[],
  services: Services,
  threadId?: string,
): Promise<CommandResult> {
  const codex = await ensureServer(services);
  const state = threadId ? getCodexState(services, threadId) : undefined;
  let accountText = 'unavailable';
  let account: any;

  try {
    const response = await codex.readAccount({ refreshToken: false });
    account = response?.account;
    if (!account) accountText = response?.requiresOpenaiAuth ? 'not authenticated' : 'none';
    else if (account.type === 'chatgpt') accountText = `chatgpt (${account.email || 'unknown'})`;
    else accountText = account.type || 'authenticated';
  } catch (error: any) {
    accountText = `unavailable (${error?.message || 'unknown error'})`;
  }

  const lines = [
    `App-server: ${codex.status}`,
    `Auth: ${accountText}`,
    `Thread: ${state?.threadId || '(none)'}`,
    `CWD: ${state?.cwd || effectiveCwd(services, threadId) || '(unset)'}`,
    `Model: ${state?.model || '(default)'}`,
    `State: ${state?.isRunning ? 'running' : state?.pendingApproval ? 'paused' : state?.chatState || 'idle'}`,
  ];
  if (state?.goal) {
    lines.push(`Goal: ${state.goal.objective} (${state.goal.status})`);
  }

  return { text: lines.join('\n'), data: { state, account } };
}

async function handleModel(
  args: string[],
  services: Services,
  threadId?: string,
): Promise<CommandResult> {
  const codex = await ensureServer(services);
  const cwd = effectiveCwd(services, threadId);

  if (args.length === 0) {
    const config = await codex.readConfig({ includeLayers: false, ...(cwd && { cwd }) });
    return { text: display(config?.config?.model), data: config };
  }

  const model = args[0];
  await codex.writeConfigValue({ keyPath: 'model', value: model, mergeStrategy: 'replace' });
  if (threadId) persistCodexState(services, threadId, { model });
  return { text: `Model set to: ${model}` };
}

async function handleModels(
  args: string[],
  services: Services,
): Promise<CommandResult> {
  const includeHidden = args.includes('--hidden') || args.includes('hidden');
  const codex = await ensureServer(services);
  const response = await codex.listModels({ limit: 100, includeHidden });
  const models = response?.data ?? [];
  if (!models.length) return { text: 'No Codex models found.', data: response };

  const lines = models.map((model: any) => {
    const marker = model.isDefault ? ' (default)' : '';
    const hidden = model.hidden ? ' [hidden]' : '';
    return `${model.id || model.model}${marker}${hidden} - ${model.displayName || model.model || model.id}`;
  });

  return { text: lines.join('\n'), data: response };
}

async function handleConfig(
  args: string[],
  services: Services,
  threadId?: string,
): Promise<CommandResult> {
  const [subcommand, key, ...rest] = args;
  if (!subcommand) return { text: 'Usage: /cdx-config get <key> | set <key> <value>' };

  const codex = await ensureServer(services);
  const cwd = effectiveCwd(services, threadId);

  switch (subcommand) {
    case 'get': {
      if (!key) return { text: 'Usage: /cdx-config get <key>' };
      const config = await codex.readConfig({ includeLayers: true, ...(cwd && { cwd }) });
      const value = getPath(config?.config, key);
      return { text: display(value), data: value };
    }
    case 'set': {
      if (!key || !rest.length) return { text: 'Usage: /cdx-config set <key> <value>' };
      const raw = rest.join(' ');
      const value = parseValue(raw);
      await codex.writeConfigValue({ keyPath: key, value, mergeStrategy: 'replace' });
      if (threadId && key === 'model' && typeof value === 'string') persistCodexState(services, threadId, { model: value });
      return { text: `Set ${key} = ${display(value)}`, data: value };
    }
    default:
      return { text: `Unknown config subcommand: ${subcommand}\nUsage: /cdx-config get <key> | set <key> <value>` };
  }
}

async function handleContext(
  _args: string[],
  services: Services,
  threadId?: string,
): Promise<CommandResult> {
  if (!threadId) return { text: 'No active thread - run a Codex turn first.' };
  const state = getCodexState(services, threadId);
  if (!state?.threadId) return { text: 'No active Codex thread - run a Codex turn first.' };

  const tokens = state.totalTokens;
  const lines = [
    `Thread: ${state.threadId}`,
    `Turns: ${state.turns ?? 0}`,
    `CWD: ${state.cwd || '(unset)'}`,
    `Model: ${state.model || '(default)'}`,
    `State: ${state.isRunning ? 'running' : state.pendingApproval ? 'paused' : state.chatState || 'idle'}`,
  ];
  if (tokens) {
    lines.push(`Tokens: input ${tokens.input ?? 0}, output ${tokens.output ?? 0}, reasoning ${tokens.reasoning ?? 0}`);
  }
  if (state.goal) {
    lines.push(`Goal: ${state.goal.objective} (${state.goal.status})`);
  }
  if (state.queuedMessage) lines.push('Queue: 1 message queued');
  if (state.recentTools?.length) {
    lines.push('Recent tools:');
    for (const tool of state.recentTools.slice(-5)) {
      lines.push(`- ${tool.name}: ${tool.summary}`);
    }
  }

  return { text: lines.join('\n'), data: state };
}

async function handleRename(
  args: string[],
  services: Services,
  threadId?: string,
): Promise<CommandResult> {
  if (!threadId) return { text: 'No active thread.' };

  const state = getCodexState(services, threadId);
  const title = args.join(' ').trim() || services.repository.chatQueries.threadData(threadId as EntityId)?.topic || 'Untitled';

  services.repository.threadCommands.update(threadId as EntityId, { topic: title });

  if (state?.threadId) {
    const codex = await ensureServer(services);
    await codex.setThreadName(state.threadId, title);
  }

  return { text: `Renamed to: ${title}` };
}

async function handleSkills(
  args: string[],
  services: Services,
  threadId?: string,
): Promise<CommandResult> {
  const codex = await ensureServer(services);
  const cwd = effectiveCwd(services, threadId);
  const forceReload = args.includes('--reload') || args.includes('reload');
  const response = await codex.listSkills({ ...(cwd && { cwds: [cwd] }), forceReload });
  const entries = response?.data ?? [];
  const skills = entries.flatMap((entry: any) => entry.skills ?? []);

  if (!skills.length) return { text: 'No Codex skills found.', data: response };

  const lines = skills.map((skill: any) => {
    const name = skill.name || skill.id || '(unnamed)';
    const source = skill.source || skill.path || '';
    return source ? `${name}  ${source}` : name;
  });
  return { text: lines.join('\n'), data: response };
}

async function handleMcp(
  _args: string[],
  services: Services,
): Promise<CommandResult> {
  const codex = await ensureServer(services);
  const response = await codex.listMcpServers({ limit: 100, detail: 'toolsAndAuthOnly' });
  const servers = response?.data ?? [];

  if (!servers.length) return { text: 'No Codex MCP servers found.', data: response };

  const lines = servers.map((server: any) => {
    const toolCount = server.tools ? Object.keys(server.tools).length : 0;
    const auth = typeof server.authStatus === 'string' ? server.authStatus : server.authStatus?.status || 'unknown';
    return `${server.name}: ${toolCount} tools, auth ${auth}`;
  });
  return { text: lines.join('\n'), data: response };
}

async function handleBypass(
  _args: string[],
  services: Services,
  threadId?: string,
): Promise<CommandResult> {
  if (!threadId) return { text: 'No active thread — run a Codex turn first.' };

  const prior = getCodexState(services, threadId);
  if (!prior) return { text: 'No Codex state on this thread.' };

  const current = prior.approvalMode ?? 'user';
  const enabling = current !== 'auto_review';
  const mode = enabling ? 'auto_review' : 'user';
  const patch: Record<string, any> = { approvalMode: mode };

  // Auto-approve pending tool requests when enabling auto_review
  if (enabling) {
    const pending = prior.pendingApproval;
    if (pending && pending.method !== 'plan/approval') {
      try {
        await (services.codex as any).respondToApproval(pending.requestId, 'acceptForSession');
      } catch { /* app-server may be gone */ }

      const asideText = `✓ Approved — ${pending.summary || 'tool request'}`;
      services.chat.updateMessageState(pending.approvalMessageId as EntityId, {
        responseTimestamp: Date.now(),
        blockResponse: { approved: true, decision: 'acceptForSession' },
        asideText,
      } as any);

      patch.pendingApproval = undefined;
      patch.isRunning = true;
    }
  }

  persistCodexState(services, threadId, patch as any);

  if (patch.isRunning) {
    updateChatState(services, threadId as EntityId, 'working');
  }

  return { text: enabling ? 'Auto-review enabled' : 'Auto-review disabled' };
}

const MAX_GOAL_CHARS = 4_000;

async function handleGoal(
  args: string[],
  services: Services,
  threadId?: string,
): Promise<CommandResult> {
  if (!threadId) return { text: 'No active thread.' };

  const [subcommand, ...rest] = args;
  const state = getCodexState(services, threadId);

  // No subcommand or "show" => display current goal
  if (!subcommand || subcommand === 'show') {
    const goal = state?.goal;
    if (!goal) return { text: 'No goal set.' };
    const lines = [
      `Objective: ${goal.objective}`,
      `Status: ${goal.status}`,
    ];
    if (goal.tokenBudget != null) {
      const remaining = Math.max(0, goal.tokenBudget - (goal.tokensUsed ?? 0));
      lines.push(`Token budget: ${goal.tokensUsed ?? 0} / ${goal.tokenBudget} (${remaining} remaining)`);
    }
    return { text: lines.join('\n'), data: goal };
  }

  switch (subcommand) {
    case 'set': {
      const objective = rest.join(' ').trim();
      if (!objective) return { text: 'Usage: /cdx-goal set <objective>' };
      if (objective.length > MAX_GOAL_CHARS) {
        return { text: `Objective too long (${objective.length} chars, max ${MAX_GOAL_CHARS}). Use a reference file for longer instructions.` };
      }
      const goal = { objective, status: 'active' as const };
      persistCodexState(services, threadId, { goal });
      return { text: `Goal set: ${objective}`, data: goal };
    }
    case 'edit': {
      const goal = state?.goal;
      if (!goal) return { text: 'No goal to edit.' };
      const objective = rest.join(' ').trim();
      if (!objective) return { text: 'Usage: /cdx-goal edit <new objective>' };
      if (objective.length > MAX_GOAL_CHARS) {
        return { text: `Objective too long (${objective.length} chars, max ${MAX_GOAL_CHARS}). Use a reference file for longer instructions.` };
      }
      const terminal = goal.status === 'budget_limited' || goal.status === 'complete';
      const updated = { ...goal, objective, objectiveEdited: true, ...(terminal && { status: 'active' as const }) };
      persistCodexState(services, threadId, { goal: updated });
      const suffix = terminal ? ' (reactivated)' : '';
      return { text: `Goal updated${suffix}: ${objective}`, data: updated };
    }
    case 'pause': {
      const goal = state?.goal;
      if (!goal) return { text: 'No goal to pause.' };
      if (goal.status !== 'active') return { text: `Goal is already ${goal.status}.` };
      const updated = { ...goal, status: 'paused' as const };
      persistCodexState(services, threadId, { goal: updated });
      return { text: `Goal paused: ${goal.objective}`, data: updated };
    }
    case 'resume': {
      const goal = state?.goal;
      if (!goal) return { text: 'No goal to resume.' };
      if (goal.status === 'active') return { text: 'Goal is already active.' };
      const resumable: string[] = ['paused', 'blocked', 'usage_limited'];
      if (!resumable.includes(goal.status)) return { text: `Cannot resume a ${goal.status} goal.` };
      const updated = { ...goal, status: 'active' as const, continuationTurns: 0 };
      persistCodexState(services, threadId, { goal: updated });
      return { text: `Goal resumed: ${goal.objective}`, data: updated };
    }
    case 'clear': {
      if (!state?.goal) return { text: 'No goal to clear.' };
      persistCodexState(services, threadId, { goal: undefined });
      return { text: 'Goal cleared.' };
    }
    default:
      return { text: `Unknown subcommand: ${subcommand}\nUsage: /cdx-goal set|show|edit|pause|resume|clear <objective>` };
  }
}
