import type { AppSettings } from '@apackdev/sdk/types';
import type { ActionMeta } from '@apackdev/sdk/build';
import type { EntityId, Services } from '#generated/services.ts';
import { getOnboardingState, persistOnboardingState, showChooseModeOrFinish, flashState, getRecentImportedThreads } from '../onboarding-helpers.ts';

export const meta: ActionMeta = {
  label: 'Handle Import Threads Step',
  description: 'Imports sessions from Claude Code and Codex as threads',
  category: 'onboarding',
  input: {
    threadId: { type: 'string', required: true },
    response: { type: 'any', required: true },
  },
};

export async function action(
  params: Record<string, any>,
  services: Services,
) {
  const threadId = params.threadId as EntityId;
  const response = params.response;
  const state = getOnboardingState(services, threadId);
  if (!state) return { success: false, reason: 'no-state' };

  flashState(services, threadId);

  // Response is an array of provider IDs (['cc', 'codex']) or 'skip'
  const selected = Array.isArray(response) ? response : typeof response === 'string' && response !== 'skip' ? [response] : [];
  const importCc = selected.includes('cc');
  const importCodex = selected.includes('codex');

  if (importCc || importCodex) {
    services.threads.updateChatState(threadId, 'working');
    await importSelectedSessions(services, { cc: importCc, codex: importCodex });
  }

  const recentThreads = getRecentImportedThreads(services, threadId);

  if (recentThreads.length > 0) {
    const choices = recentThreads.map((t: any) => ({
      id: t.id,
      label: t.topic || 'Untitled',
    }));

    const { messageId } = services.chat.sendChoiceBlock({
      threadId,
      text: "Here are your most recent threads. Want to continue where you left off?",
      prompt: 'Pick a thread to continue',
      choices,
      skipOption: { id: 'skip', label: 'Skip' },
      allowCustom: false,
      compact: true,
      forkable: false,
      autoHide: true,
      asUser: true,
    });

    state.step = 'pick-thread';
    state.pendingMessageId = messageId;
  } else {
    showChooseModeOrFinish(services, state, threadId);
  }

  persistOnboardingState(services, threadId, state);
  return { success: true, step: state.step };
}

// ─── Unified import from both providers ─────────────────────────────────────

async function importSelectedSessions(services: Services, providers: { cc: boolean; codex: boolean }) {
  try {
    const projects = services.settings.get<AppSettings>({ kind: 'app' }).projects ?? [];
    const selectedDirs = new Set((projects as any[]).flatMap((p: any) => p.directories ?? []));

    // Build dedup sets from existing threads
    const existingCcIds = new Set<string>();
    const existingCodexIds = new Set<string>();
    for (const thread of services.repository.threadQueries.all()) {
      const ccSid = (thread as any)?.context?.claudeCode?.sessionId;
      if (ccSid) existingCcIds.add(ccSid);
      const cdxTid = (thread as any)?.context?.codex?.threadId;
      if (cdxTid) existingCodexIds.add(cdxTid);
    }

    // Fetch and import only the selected providers
    if (providers.cc) {
      const ccSessions = await services.cli.claudeCode.listAllSessions({ limit: 50 }).catch(() => [] as any[]);
      const ccToImport = ccSessions
        .filter((s: any) => !selectedDirs.size || (s.cwd && selectedDirs.has(s.cwd)))
        .filter((s: any) => !existingCcIds.has(s.id));
      if (ccToImport.length) await importCcSessions(services, ccToImport);
    }

    if (providers.codex) {
      const codexSessions = await (services.codex as any).listAllSessions({ limit: 50 }).catch(() => [] as any[]);
      const codexToImport = codexSessions
        .filter((s: any) => !selectedDirs.size || (s.cwd && selectedDirs.has(s.cwd)))
        .filter((s: any) => !existingCodexIds.has(s.id));
      if (codexToImport.length) await importCodexSessions(services, codexToImport);
    }
  } catch {
    // Best-effort
  }
}

// ─── CC import ──────────────────────────────────────────────────────────────

async function importCcSessions(services: Services, toImport: any[]) {
  const CONCURRENCY = 8;
  const loaded: Array<{ session: any; transcript: any[] }> = [];
  for (let i = 0; i < toImport.length; i += CONCURRENCY) {
    const batch = toImport.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      batch.map(async (session: any) => {
        try {
          const transcript = session.file
            ? await services.cli.claudeCode.viewSessionByFile(session.file)
            : await services.cli.claudeCode.viewSession(session.id, { cwd: session.cwd });
          return { session, transcript };
        } catch { return null; }
      })
    );
    for (const r of results) { if (r) loaded.push(r); }
  }

  for (const { session, transcript } of loaded) {
    try {
      const cwd = session.cwd || '';
      const dirName = cwd.split('/').filter(Boolean).pop();
      const prefix = dirName ? `[${dirName}] ` : '';
      let sessionTitle = session.title;
      if (!sessionTitle) {
        for (const e of transcript) {
          if ((e as any).type === 'user' && (e as any).message?.role === 'user') {
            const text = extractCcText((e as any).message.content);
            if (text) { sessionTitle = text.slice(0, 60); break; }
          }
        }
        if (!sessionTitle) sessionTitle = `Session ${session.id.slice(0, 8)}`;
      }

      const { id: newThreadId } = services.repository.threadCommands.create({
        topic: `${prefix}${sessionTitle}`,
        instructions: '',
        tags: ['imported'],
      });

      const messages: Array<{ text: string; sender: 'user' | 'assistant'; forkable?: boolean; context?: Record<string, unknown> }> = [];
      for (const entry of transcript) {
        const msg = (entry as any).message;
        const uuid = (entry as any).uuid;
        if ((entry as any).type === 'user' && msg?.role === 'user') {
          const text = extractCcText(msg.content);
          if (!text) continue;
          messages.push({ text, sender: 'user', forkable: false, ...(uuid && { context: { cliUuid: uuid } }) });
        } else if ((entry as any).type === 'assistant') {
          const text = extractCcText(msg?.content) || '(tool use only)';
          messages.push({ text, sender: 'assistant', forkable: !!uuid, ...(uuid && { context: { cliUuid: uuid } }) });
        }
      }

      if (messages.length > 0) {
        services.chat.addMessagesToThread({ threadId: newThreadId as any, messages: messages as any });
      }

      const thread = services.repository.threadQueries.byId(newThreadId) as any;
      services.repository.threadCommands.update(newThreadId, {
        context: { ...thread?.context, claudeCode: { sessionId: session.id, cwd: cwd || undefined } },
        tags: [...(thread?.tags || ['imported']), 'claude-code'],
      });

      services.repository.chatCommands.createArtifact({
        artifactType: 'claude-session',
        title: 'Claude Code session',
        content: {
          sessionId: session.id, model: '', cwd,
          startedAt: Date.now(), lastTurnAt: Date.now(), turns: 0,
          totalCostUsd: 0, chatState: 'idle',
          toolCallCount: 0, permissionMode: 'default',
        },
        threadId: newThreadId,
      });
    } catch { /* skip individual failures */ }
  }
}

// ─── Codex import ───────────────────────────────────────────────────────────

async function importCodexSessions(services: Services, toImport: any[]) {
  const CONCURRENCY = 8;
  const loaded: Array<{ session: any; transcript: any[] }> = [];
  for (let i = 0; i < toImport.length; i += CONCURRENCY) {
    const batch = toImport.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      batch.map(async (session: any) => {
        try {
          const transcript = await (services.codex as any).viewSessionByFile(session.file);
          return { session, transcript };
        } catch { return null; }
      })
    );
    for (const r of results) { if (r) loaded.push(r); }
  }

  for (const { session, transcript } of loaded) {
    try {
      const cwd = session.cwd || '';
      const dirName = cwd.split('/').filter(Boolean).pop();
      const prefix = dirName ? `[${dirName}] ` : '';
      const sessionTitle = session.title || `Session ${session.id.slice(0, 8)}`;

      const { id: newThreadId } = services.repository.threadCommands.create({
        topic: `${prefix}${sessionTitle}`,
        instructions: '',
        tags: ['imported'],
      });

      const messages: Array<{ text: string; sender: 'user' | 'assistant'; forkable?: boolean }> = [];
      for (const entry of transcript) {
        const payload = (entry as any).payload;
        if ((entry as any).type !== 'response_item' || !payload) continue;

        if (payload.role === 'user') {
          const text = extractCodexText(payload.content);
          if (!text) continue;
          messages.push({ text, sender: 'user', forkable: false });
        } else if (payload.role === 'assistant') {
          const text = extractCodexText(payload.content);
          if (!text) continue;
          messages.push({ text, sender: 'assistant', forkable: true });
        }
      }

      if (messages.length > 0) {
        services.chat.addMessagesToThread({ threadId: newThreadId as any, messages: messages as any });
      }

      const thread = services.repository.threadQueries.byId(newThreadId) as any;
      services.repository.threadCommands.update(newThreadId, {
        context: {
          ...thread?.context,
          codex: {
            threadId: session.id,
            cwd: cwd || undefined,
            approvalMode: 'user',
            sandbox: 'workspace-write',
            chatState: 'idle',
          },
        },
        tags: [...(thread?.tags || ['imported']), 'codex'],
      });

      services.repository.chatCommands.createArtifact({
        artifactType: 'codex-session',
        title: 'Codex session',
        content: {},
        threadId: newThreadId,
      });
    } catch { /* skip individual failures */ }
  }
}

// ─── Text extraction helpers ────────────────────────────────────────────────

/** Extract text from Claude Code message content (string or text blocks). */
function extractCcText(content: any): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((b: any) => b.type === 'text' && b.text)
    .map((b: any) => b.text)
    .join('\n');
}

/** Extract text from Codex response_item content (input_text/output_text blocks). */
function extractCodexText(content: any): string {
  if (!Array.isArray(content)) return '';
  return content
    .filter((b: any) => (b.type === 'input_text' || b.type === 'output_text') && b.text)
    .map((b: any) => b.text)
    .filter((t: string) => !t.startsWith('<environment_context>'))
    .join('\n');
}
