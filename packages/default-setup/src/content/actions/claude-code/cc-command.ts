/**
 * CC: Run Command — dispatcher for lightweight cc- commands (info, config, passthrough).
 *
 * Heavy operations are routed by the flow to separate actions:
 * - CC: Session Ops (cc-session-ops.ts) — resume, import
 * - CC: Thread Ops (cc-thread-ops.ts) — compact, fork, add-dir, set-dir
 */

import type { ActionMeta } from '@apackdev/sdk/build';
import type { Services, Z } from '#generated/services.ts';
import { getClaudeState, persistClaudeState, updateChatState } from './_helpers/thread-context.ts';
import { DONT_BYPASS } from './_helpers/auto-approve.ts';

export const meta: ActionMeta = {
  label: 'CC: Run Command',
  description: 'Unified dispatcher for cc- prefixed chat commands',
  category: 'claude-code',
  input: {
    command: { type: 'string', description: 'Full command name (e.g. cc-sessions)', required: true },
    text: { type: 'string', description: 'Arguments after the command', required: false },
    threadId: { type: 'string', description: 'Thread ID for response', required: false },
    references: { type: 'object', description: 'Attached references (images, files, context)', required: false },
  },
};

type Handler = (
  args: string[],
  services: Services,
  threadId?: string,
) => Promise<{ text: string; data?: any }>;

// ── Passthrough commands ─────────────────────────────────────────────
// Commands that map directly to `claude <subcommand> [...args]` and
// relay stdout. Only commands registered as top-level CLI subcommands
// (via Commander.js in main.tsx) work here — REPL-only slash commands
// need dedicated handlers instead.

const PASSTHROUGH: Record<string, { cmd: string; defaultArgs?: string[] }> = {
  doctor: { cmd: 'doctor' },
  mcp:    { cmd: 'mcp', defaultArgs: ['list'] },
  agents: { cmd: 'agents' },
};

function makePassthroughHandler(spec: { cmd: string; defaultArgs?: string[] }): Handler {
  return async (args, services) => {
    const fullArgs = [spec.cmd, ...(args.length > 0 ? args : spec.defaultArgs ?? [])];
    const result = await services.cli.claudeCode.exec(fullArgs);
    const output = (result.stdout + result.stderr).trim();
    return { text: output || `(no output from cc-${spec.cmd})` };
  };
}

// ── Handler registry ────────────────────────────────────────────────

const handlers: Record<string, Handler> = {
  sessions: handleSessions,
  config: handleConfig,
  status: handleStats,
  model: handleModel,
  memory: handleMemory,
  skills: handleSkills,
  stats: handleStats,
  rename: handleRename,
  bypass: handleBypass,
  // Passthrough commands — exec and relay stdout
  ...Object.fromEntries(
    Object.entries(PASSTHROUGH).map(([name, spec]) => [name, makePassthroughHandler(spec)]),
  ),
};

// ── Dispatcher ──────────────────────────────────────────────────────

export async function action(
  params: Record<string, any>,
  services: Services,
  _z: Z,
  _flowId: string,
) {
  const { command, text, threadId } = params;
  const name = (command as string).replace(/^cc-/, '');
  const args = text?.trim() ? text.trim().split(/\s+/) : [];

  const handler = handlers[name];

  let result: { text: string; data?: any; blocks?: any[]; skipMessage?: boolean };

  if (handler) {
    try {
      result = await handler(args, services, threadId);
    } catch (error: any) {
      result = { text: `cc-${name} failed: ${error?.message || 'Unknown error'}` };
    }
  } else {
    const available = Object.keys(handlers).map(k => `cc-${k}`).join(', ');
    result = { text: `Unknown command: cc-${name}\nAvailable: ${available}` };
  }

  if (threadId && !result.skipMessage) {
    services.chat.sendBlockMessage({
      threadId,
      text: result.text,
      blocks: result.blocks ?? [],
    });
  }

  return { success: !!handler, command: `cc-${name}`, text: result.text, data: result.data };
}

// ── Handlers ────────────────────────────────────────────────────────

async function handleSessions(
  args: string[],
  services: Services,
  threadId?: string,
): Promise<{ text: string; data?: any; blocks?: any[] }> {
  // Resolve effective cwd from thread context so sessions are scoped to the
  // correct project directory (e.g. thread created via "+ new thread" menu).
  const prior = threadId ? getClaudeState(services, threadId) : undefined;
  const codeSettings = services.settings.get({ kind: 'feature', featureRef: 'default-setup/code' }) as any;
  const effectiveCwd = prior?.cwdOverride
    || prior?.cwd
    || codeSettings?.defaultBaseDirectory
    || codeSettings?.baseDirectory
    || undefined;
  const cwdOpts = effectiveCwd ? { cwd: effectiveCwd } : undefined;

  const [sessionId] = args;

  if (sessionId) {
    const entries = await services.cli.claudeCode.viewSession(sessionId);
    const summary = entries
      .filter(e => e.type === 'user' || e.type === 'assistant')
      .slice(0, 10)
      .map(e => `[${e.type}] ${typeof e.message === 'string' ? e.message : JSON.stringify(e.message)}`)
      .join('\n');
    return {
      text: summary || `Session ${sessionId}: no messages found`,
      data: entries,
    };
  }

  const sessions = await services.cli.claudeCode.listSessions(cwdOpts);
  if (!sessions.length) return { text: 'No sessions found.' };

  const items = sessions.map(s => ({
    id: s.id,
    title: s.title || '(untitled)',
    modifiedAt: s.modifiedAt ? new Date(s.modifiedAt).toISOString() : '',
    size: s.size ?? 0,
  }));

  return {
    text: `${sessions.length} sessions`,
    blocks: [{ type: 'session-list', props: { sessions: items } }],
    data: sessions,
  };
}

async function handleConfig(
  args: string[],
  services: Services,
): Promise<{ text: string; data?: any }> {
  const [subcommand, key, ...rest] = args;

  if (!subcommand) {
    return { text: 'Usage: /cc-config get <key> | set <key> <value>' };
  }

  const settings = await services.cli.claudeCode.readSettings();

  switch (subcommand) {
    case 'get': {
      if (!key) return { text: 'Usage: /cc-config get <key>' };
      const value = settings[key];
      if (value === undefined) return { text: `(no value for "${key}")` };
      const display = typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value);
      return { text: display, data: value };
    }
    case 'set': {
      if (!key || !rest.length) return { text: 'Usage: /cc-config set <key> <value>' };
      const raw = rest.join(' ');
      let parsed: any = raw;
      try { parsed = JSON.parse(raw); } catch { /* keep as string */ }
      settings[key] = parsed;
      await services.cli.claudeCode.writeSettings(settings);
      return { text: `Set ${key} = ${raw}` };
    }
    default:
      return { text: `Unknown config subcommand: ${subcommand}\nUsage: /cc-config get <key> | set <key> <value>` };
  }
}

async function handleModel(
  args: string[],
  services: Services,
): Promise<{ text: string; data?: any }> {
  const settings = await services.cli.claudeCode.readSettings();
  if (args.length === 0) {
    return { text: settings.model || '(using default model)' };
  }
  settings.model = args[0];
  await services.cli.claudeCode.writeSettings(settings);
  return { text: `Model set to: ${args[0]}` };
}

async function handleMemory(
  args: string[],
  services: Services,
): Promise<{ text: string; data?: any }> {
  if (args[0] === 'add' || args[0] === 'remove') {
    return { text: `Memory add/remove is only available in the Claude Code terminal. Use /memory ${args[0]} there.` };
  }
  const files = await services.cli.claudeCode.listMemoryFiles();
  if (!files.length) return { text: 'No memory files found.' };
  const lines = files.map((f: any) => {
    const scope = f.scope ? ` [${f.scope}]` : '';
    return `${f.name}${scope}  ${f.path}`;
  });
  return { text: lines.join('\n'), data: files };
}

async function handleSkills(
  _args: string[],
  services: Services,
): Promise<{ text: string; data?: any }> {
  const skills = await services.cli.claudeCode.listSkills();
  if (!skills.length) return { text: 'No skills installed.' };
  const lines = skills.map((s: any) => {
    const scope = s.scope ? ` [${s.scope}]` : '';
    return `${s.name}${scope}`;
  });
  return { text: lines.join('\n'), data: skills };
}

async function handleStats(
  _args: string[],
  services: Services,
): Promise<{ text: string; data?: any }> {
  const [version, auth, settings] = await Promise.all([
    services.cli.claudeCode.version(),
    services.cli.claudeCode.authStatus(),
    services.cli.claudeCode.readSettings(),
  ]);
  const lines = [
    `Version: ${version.trim()}`,
    `Auth: ${auth.authenticated ? 'authenticated' : 'not authenticated'}`,
  ];
  if (settings.model) lines.push(`Model: ${settings.model}`);
  return { text: lines.join('\n'), data: { version, auth, settings } };
}

async function handleRename(
  args: string[],
  services: Services,
  threadId?: string,
): Promise<{ text: string; data?: any }> {
  if (!threadId) return { text: 'No active thread — run a Claude Code turn first.' };

  const ccState = getClaudeState(services, threadId);
  const sessionId = ccState?.sessionId;
  if (!sessionId) return { text: 'No active session — run a Claude Code turn first.' };

  let newTitle: string;

  if (args.length > 0) {
    newTitle = args.join(' ');
  } else {
    newTitle = await generateTitle(services, threadId);
  }

  // /rename is REPL-only — doesn't work via `claude -p`. Use direct JSONL rename.
  await services.cli.claudeCode.renameSession(sessionId, newTitle, {
    ...(ccState.cwd && { cwd: ccState.cwd }),
  });

  services.repository.threadCommands.update(threadId as any, { topic: newTitle });

  return { text: `Renamed to: ${newTitle}` };
}

async function generateTitle(services: Services, threadId: string): Promise<string> {
  const threadData = services.repository.chatQueries.threadData(threadId as any);
  const messages = threadData?.messages ?? [];

  if (messages.length === 0) return 'Untitled';

  const serialized = messages
    .filter((m: any) => !m.compacted && m.status !== 'cancelled' && m.text
      && !(m.sender === 'user' && /^\/\S+/.test(m.text)))
    .slice(-10)
    .map((m: any) => {
      const role = m.sender === 'user' ? 'User' : 'Assistant';
      return `[${role}] ${m.text}`;
    })
    .join('\n');

  if (!serialized) return 'Untitled';

  const handle = await services.cli.claudeCode.query({
    prompt: `Generate a short, descriptive title (3-6 words, no quotes) for this conversation. Respond with ONLY the title text, nothing else.\n\n${serialized}`,
    permissionMode: 'plan',
    allowedTools: [],
    noSessionPersistence: true,
    maxTurns: 1,
  });

  for await (const _ev of handle.events) { /* drain */ }
  const result = await handle.result;
  const title = result.text?.trim().replace(/^["']|["']$/g, '') || '';

  // Reject obviously bad titles (too long or LLM went off-script)
  if (!title || title.length > 60 || title.includes('\n')) return 'Untitled';
  return title;
}

async function handleBypass(
  _args: string[],
  services: Services,
  threadId?: string,
): Promise<{ text: string; data?: any }> {
  if (!threadId) return { text: 'No active thread — run a Claude Code turn first.' };

  const prior = getClaudeState(services, threadId);
  if (!prior) return { text: 'No Claude Code state on this thread.' };

  const current = prior.permissionMode ?? 'default';
  const enabling = current !== 'bypassPermissions';
  const mode = enabling ? 'bypassPermissions' : 'default';
  const updates: Record<string, unknown> = { permissionMode: mode };

  // Auto-approve pending control request when enabling bypass
  if (enabling) {
    const pending = prior.pendingControlRequest;
    if (pending?.requestId && !DONT_BYPASS.has(pending.toolName)) {
      const handle = (services.cli as any).claudeCode.getHandle(threadId);
      if (handle) {
        handle.respond(pending.requestId, {
          behavior: 'allow',
          updatedInput: pending.originalInput ?? {},
        });
        services.chat.updateMessageState(pending.approvalMessageId as any, {
          responseTimestamp: Date.now(),
          blockResponse: { approved: true },
        } as any);
        updates.pendingControlRequest = undefined;
        updates.isRunning = true;
      }
    }
  }

  persistClaudeState(services, threadId, updates as any);

  if (updates.isRunning) {
    updateChatState(services, threadId as any, 'working');
  }

  return { text: enabling ? 'Bypass enabled' : 'Bypass disabled' };
}
