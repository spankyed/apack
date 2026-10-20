/**
 * CC: Session Ops — handles session-heavy cc- commands (resume, import).
 *
 * Separated from cc-command.ts because these handlers share transcript
 * parsing, message import, and session artifact setup plumbing.
 */

import { importedSessionMetadata } from './_helpers/session-import.ts';
import type { ActionMeta } from '@apackdev/sdk/build';
import type { Services, Z } from '#generated/services.ts';
import type { ThreadsSettings } from '#generated/types.ts';
import { getClaudeState, persistClaudeState, ensureSessionMarker, updateChatState } from './_helpers/thread-context.ts';

export const meta: ActionMeta = {
  label: 'CC: Session Ops',
  description: 'Dispatcher for session-heavy cc- commands (resume, import)',
  category: 'claude-code',
  input: {
    command: { type: 'string', description: 'Full command name (e.g. cc-resume)', required: true },
    text: { type: 'string', description: 'Arguments after the command', required: false },
    threadId: { type: 'string', description: 'Thread ID for response', required: false },
    references: { type: 'object', description: 'Attached references', required: false },
  },
};

type Handler = (
  args: string[],
  services: Services,
  threadId?: string,
  cwdOverride?: string,
) => Promise<{ text: string; data?: any; blocks?: any[]; skipMessage?: boolean }>;

const handlers: Record<string, Handler> = {
  resume: handleResume,
  import: handleImport,
};

export async function action(
  params: Record<string, any>,
  services: Services,
  _z: Z,
  _flowId: string,
) {
  const { command, text, threadId, cwdOverride } = params;
  const name = (command as string).replace(/^cc-/, '');
  const args = text?.trim() ? text.trim().split(/\s+/) : [];

  const handler = handlers[name];
  let result: { text: string; data?: any; blocks?: any[]; skipMessage?: boolean };

  if (handler) {
    try {
      result = await handler(args, services, threadId, cwdOverride);
    } catch (error: any) {
      result = { text: `cc-${name} failed: ${error?.message || 'Unknown error'}` };
    }
  } else {
    result = { text: `Unknown session command: cc-${name}` };
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

async function handleResume(
  args: string[],
  services: Services,
  threadId?: string,
  cwdOverride?: string,
): Promise<{ text: string; data?: any; blocks?: any[]; skipMessage?: boolean }> {
  // Join args back and strip outer quotes to support titles with spaces
  // e.g. `/cc-resume "Branched conversation (Branch 14)"`
  const identifier = args.join(' ').replace(/^["']|["']$/g, '').trim();

  // Resolve the thread's effective cwd so listSessions scopes to the right
  // project directory (e.g. when the thread was created via "+ new thread"
  // on a specific project in the sidebar).
  const prior = threadId ? getClaudeState(services, threadId) : undefined;
  const codeSettings = services.settings.get({ kind: 'feature', featureRef: 'default-setup/code' }) as any;
  const effectiveCwd = cwdOverride
    || prior?.cwdOverride
    || prior?.cwd
    || codeSettings?.defaultBaseDirectory
    || codeSettings?.baseDirectory
    || undefined;
  const cwdOpts = effectiveCwd ? { cwd: effectiveCwd } : undefined;

  // No args: show session picker
  if (!identifier) {
    const sessions = await services.cli.claudeCode.listSessions(cwdOpts);
    if (!sessions.length) return { text: 'No sessions found.' };

    const items = sessions.map((s: any) => ({
      id: s.id,
      title: s.title || '(untitled)',
      modifiedAt: s.modifiedAt ? new Date(s.modifiedAt).toISOString() : '',
      size: s.size ?? 0,
    }));

    return {
      text: 'Pick a session to resume (use `/cc-resume <session-id>`):',
      blocks: [{ type: 'session-list', props: { sessions: items } }],
      data: sessions,
    };
  }

  // Validate session exists — match by UUID first, then by title
  const sessions = await services.cli.claudeCode.listSessions(cwdOpts);
  const session = sessions.find((s: any) => s.id === identifier)
    || sessions.find((s: any) => s.title && s.title.toLowerCase() === identifier.toLowerCase());
  if (!session) return { text: `Session not found: ${identifier}` };

  if (!threadId) return { text: 'No active thread.' };

  const sessionId = session.id;

  const represented = services.repository.threadQueries.all().filter(candidate => {
    const state = candidate.context?.claudeCode;
    return !state?.forkFrom && !state?.revertTo && !state?.forkPending;
  });
  const liveSession = (id: string) => services.cli.claudeCode.getNativeTerminal(id)?.state.sessionId
    ?? services.cli.claudeCode.getConversation(id)?.owner.sessionId;
  const existing = represented.find(candidate => liveSession(candidate.id) === sessionId)
    ?? represented.find(candidate => !liveSession(candidate.id) && candidate.context?.claudeCode?.sessionId === sessionId);
  if (existing) {
    const text = 'Continuing the existing app conversation for this Claude Code session.';
    services.chat.sendBlockMessage({ threadId: existing.id, text, blocks: [] });
    services.chat.openThreadChatAndRefreshRecent(existing.id);
    return { text, skipMessage: true };
  }

  // Fetch transcript for message import — use the session's own cwd bucket
  const transcript = await services.cli.claudeCode.viewSession(sessionId, { cwd: (session as any).cwd });

  // Preserve existing conversation and staged history when importing an unrepresented session.
  const existingMessages = services.repository.threadQueries.messages(threadId as any);
  const requiresNewThread = !!(prior?.forkFrom || prior?.revertTo || prior?.forkPending) || existingMessages?.some((m: any) =>
    m.sender === 'user' && !m.isCommand
  );
  let targetThreadId = threadId;

  if (requiresNewThread) {
    const title = (session as any).title || 'Resumed session';
    const { id: newThreadId } = services.chat.createThreadAndNotify({
      topic: title,
      instructions: '',
    });
    targetThreadId = newThreadId as string;
  } else {
    // Empty thread — reuse it and rename to match the session
    const title = (session as any).title || 'Resumed session';
    services.repository.threadCommands.update(threadId as any, { topic: title });
  }

  // Import messages from transcript (batch — no per-message events)
  const importedCount = services.chat.importClaudeSessionMessages({threadId: targetThreadId as any, transcript, sessionId});

  // Set up session state — persistClaudeState adds 'claude-code' tag
  persistClaudeState(services, targetThreadId, {
    sessionId,
    historyError: undefined,
    ...importedSessionMetadata(transcript, sessionId, (session as any).cwd),
    cwd: (session as any).cwd || '',
    sessionWorktree: false,
  });
  ensureSessionMarker(services, targetThreadId as any);
  updateChatState(services, targetThreadId as any, 'idle');

  // Build confirmation text
  const sessionTitle = (session as any).title || '(untitled)';
  const confirmText = `Session resumed: **${sessionTitle}** (${importedCount} messages imported)\nSend a message to continue.`;

  if (requiresNewThread) {
    // New thread: send confirmation there and navigate
    services.chat.sendBlockMessage({
      threadId: targetThreadId as any,
      text: confirmText,
      blocks: [],
    });
    services.chat.openThreadChatAndRefreshRecent(targetThreadId as any);
    return { text: confirmText, skipMessage: true };
  }

  // Same thread: reload thread data to show imported messages
  const threadData = services.repository.chatQueries.threadData(targetThreadId as any);
  if (threadData) services.emitter.broadcastToSurface('default-setup/threads', { type: 'LOAD_CHAT_THREAD', data: threadData });

  return { text: confirmText };
}

// ── Import ──────────────────────────────────────────────────────────

const DEFAULT_IMPORT_LIMIT = 50;

/** Extract the last path segment from a cwd for use as a thread title prefix. */
function dirPrefix(cwd?: string): string {
  if (!cwd) return '';
  const segments = cwd.split('/').filter(Boolean);
  const last = segments[segments.length - 1];
  return last ? `[${last}] ` : '';
}

async function handleImport(
  args: string[],
  services: Services,
  threadId?: string,
): Promise<{ text: string; data?: any; skipMessage?: boolean }> {
  const allDirs = args.includes('all');
  const noLimit = args.includes('no-limit');
  const limit = noLimit ? undefined : DEFAULT_IMPORT_LIMIT;

  // List sessions — either current directory or all project directories
  const sessions = allDirs
    ? await services.cli.claudeCode.listAllSessions(limit ? { limit } : undefined)
    : await services.cli.claudeCode.listSessions(limit ? { limit } : undefined);

  if (!sessions.length) return { text: 'No sessions found to import.' };

  // Build set of already-imported sessionIds to avoid duplicates
  const existingSessionIds = new Set<string>();
  for (const thread of services.repository.threadQueries.all()) {
    const sid = (thread as any)?.context?.claudeCode?.sessionId;
    if (sid) existingSessionIds.add(sid);
  }

  const toImport = sessions.filter((s: any) => !existingSessionIds.has(s.id));
  const alreadyImported = sessions.length - toImport.length;

  if (!toImport.length) {
    return { text: `All ${sessions.length} sessions are already imported.` };
  }

  if (!threadId) return { text: 'No active thread.' };

  // Send progress message
  const scope = allDirs ? 'across all directories' : 'from current directory';
  const { messageId: progressMsgId } = services.chat.sendBlockMessage({
    threadId: threadId as any,
    text: `Importing ${toImport.length} sessions ${scope}…`,
    blocks: [],
  });

  let imported = 0;
  let failed = 0;

  for (const session of toImport) {
    try {
      // Use viewSessionByFile when we have a file path (works for cross-directory imports)
      const transcript = (session as any).file
        ? await services.cli.claudeCode.viewSessionByFile((session as any).file)
        : await services.cli.claudeCode.viewSession(session.id, { cwd: (session as any).cwd });

      const prefix = dirPrefix((session as any).cwd);
      const sessionTitle = (session as any).title || `Session ${session.id.slice(0, 8)}`;
      const title = `${prefix}${sessionTitle}`;

      // Create thread directly (no per-thread frontend events)
      const { id: newThreadId } = services.repository.threadCommands.create({
        topic: title,
        instructions: '',
        tags: ['imported'],
      });

      // Import messages
      services.chat.importClaudeSessionMessages({threadId: newThreadId, transcript, sessionId: session.id});

      // Write session state directly — no frontend events during bulk import.
      // Using persistClaudeState + ensureSessionMarker would emit THREAD_UPDATED
      // + ARTIFACT_ADDED per thread, causing an event storm that crashes the frontend.
      const thread = services.repository.threadQueries.byId(newThreadId) as any;
      const ccState = {
        sessionId: session.id, sessionWorktree: false, cwd: (session as any).cwd || undefined,
        chatState: 'idle', permissionMode: 'default', ...importedSessionMetadata(transcript, session.id, (session as any).cwd),
      };

      // Write full session state to thread context (source of truth).
      services.repository.threadCommands.update(newThreadId, {
        context: { ...thread?.context, claudeCode: ccState },
        tags: [...(thread?.tags || ['imported']), 'claude-code'],
      });

      // Create artifact as a type marker (content lives on thread context).
      services.repository.chatCommands.createArtifact({
        artifactType: 'claude-session' as any,
        title: 'Claude Code session',
        content: {},
        threadId: newThreadId,
      });

      imported++;
    } catch {
      failed++;
    }
  }

  // Update progress message with final summary
  const parts = [`Imported ${imported} sessions.`];
  if (alreadyImported > 0) parts.push(`${alreadyImported} already imported.`);
  if (failed > 0) parts.push(`${failed} failed.`);
  const summary = parts.join(' ');

  services.chat.updateMessageState(progressMsgId as any, { text: summary });

  // Full refresh: update the entire thread list, tags, and chat states.
  // sendRecentThreadsRefresh() only updates the sidebar (recent 7 threads).
  const connectedData = services.repository.threadQueries.connectedData();
  const threadsSettings = services.settings.get<ThreadsSettings>({ kind: 'feature', featureRef: 'default-setup/threads' });
  services.emitter.broadcastToSurface('default-setup/threads', {
    type: 'THREAD_CONNECTED',
    data: { ...connectedData, settings: threadsSettings || null },
  });

  return { text: summary, skipMessage: true };
}
