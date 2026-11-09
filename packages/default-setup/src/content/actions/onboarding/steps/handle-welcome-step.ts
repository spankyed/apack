import type { AppSettings } from '@apackdev/sdk/types';
import type { ActionMeta } from '@apackdev/sdk/build';
import type { EntityId, Services } from '#generated/services.ts';
import { getOnboardingState, persistOnboardingState, flashState } from '../onboarding-helpers.ts';

export const meta: ActionMeta = {
  label: 'Handle Welcome Step',
  description: 'Detects CLIs, discovers sessions, and presents project directory selection',
  category: 'onboarding',
  input: {
    threadId: { type: 'string', required: true },
    response: { type: 'any', required: false },
  },
};

export async function action(
  params: Record<string, any>,
  services: Services,
) {
  const threadId = params.threadId as EntityId;
  const state = getOnboardingState(services, threadId);
  if (!state) return { success: false, reason: 'no-state' };

  flashState(services, threadId);

  // ── Detect both CLIs in parallel ──────────────────────────────────
  const [ccResult, codexResult] = await Promise.all([
    services.cli.testCli('claude-code'),
    services.cli.testCli('codex'),
  ]);

  const ccFound = ccResult.success;
  const codexFound = codexResult.success;

  let ccAuthenticated = false;
  if (ccFound) {
    try {
      const auth = await services.cli.claudeCode.authStatus();
      ccAuthenticated = (auth as any).authenticated === true || (auth as any).loggedIn === true;
    } catch { /* auth check failed */ }
  }

  state.data.cliFound = ccFound;
  state.data.authenticated = ccAuthenticated;
  state.data.codexFound = codexFound;

  // ── Status message ────────────────────────────────────────────────
  const lines: string[] = [];
  if (ccFound && ccAuthenticated) lines.push('**Claude Code** — ready to go');
  else if (ccFound) lines.push('**Claude Code** — installed but needs authentication. Run `claude` in your terminal to sign in.');
  else lines.push('**Claude Code** — not installed. You can add it later with `npm i -g @anthropic-ai/claude-code`');

  if (codexFound) lines.push('**Codex** — ready to go');
  else lines.push('**Codex** — not installed. You can add it later with `npm i -g @openai/codex`');

  services.chat.sendBlockMessage({ threadId, text: lines.join('\n'), blocks: [], forkable: false });

  // ── Discover sessions from both providers → extract project dirs ──
  const [ccSessions, codexSessions] = await Promise.all([
    ccFound
      ? services.cli.claudeCode.listAllSessions({ limit: 50 }).catch(() => [] as any[])
      : Promise.resolve([] as any[]),
    codexFound
      ? (services.codex as any).listAllSessions({ limit: 50 }).catch(() => [] as any[])
      : Promise.resolve([] as any[]),
  ]);

  state.data.ccSessionCount = ccSessions.length;
  state.data.codexSessionCount = codexSessions.length;

  // Extract unique project directories from all sessions
  const cwdSet = new Set<string>();
  for (const s of [...ccSessions, ...codexSessions]) {
    if (s.cwd) cwdSet.add(s.cwd);
  }
  const projectDirs = Array.from(cwdSet);

  if (projectDirs.length > 0) {
    // Show multi-select of discovered directories
    const choices = projectDirs.map((dir: string) => {
      const name = dir.split('/').filter(Boolean).pop() || dir;
      return { id: dir, label: name, description: dir };
    });

    const { messageId } = services.chat.sendChoiceBlock({
      threadId,
      text: `I found ${projectDirs.length} project director${projectDirs.length === 1 ? 'y' : 'ies'} from your ${[ccSessions.length > 0 && 'Claude Code', codexSessions.length > 0 && 'Codex'].filter(Boolean).join(' and ')} sessions. Select the ones you'd like to add.`,
      prompt: 'Select projects to add',
      choices,
      multiSelect: true,
      skipOption: { id: 'skip', label: 'Skip' },
      allowCustom: false,
      compact: true,
      forkable: false,
      autoHide: true,
      asUser: true,
    });

    state.step = 'projects';
    state.pendingMessageId = messageId;
  } else {
    // No sessions found — show file-picker as fallback
    const projects = services.settings.get<AppSettings>({ kind: 'app' }).projects;
    const { messageId } = services.chat.sendBlockMessage({
      threadId,
      text: 'No existing sessions found. Pick a project directory to get started, or skip to set one up later.',
      blocks: [
        { type: 'prompt', props: { content: 'Select a project directory' } },
        ...(projects.length > 0 ? [{ type: 'project-select', props: { projects } }] : []),
        { type: 'file-picker', props: { fileType: 'directory' } },
      ],
      forkable: false,
      autoHide: true,
      asUser: true,
      asideContext: 'Project',
    } as any);

    state.step = 'projects';
    state.pendingMessageId = messageId;
  }

  persistOnboardingState(services, threadId, state);
  return { success: true, step: state.step };
}
