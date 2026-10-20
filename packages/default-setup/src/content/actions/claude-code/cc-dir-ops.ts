/**
 * CC: Dir Ops — handles directory-related cc- commands (add-dir, set-dir).
 *
 * Shared helpers: parseDirPath, shortenPath
 */

import type { ActionMeta } from '@apackdev/sdk/build';
import type { Services, Z } from '#generated/services.ts';
import { parseCommandArguments } from './_helpers/command-arguments.ts';
import { getClaudeState, persistClaudeState, setProjectDirectory, updateClaudeState } from './_helpers/thread-context.ts';

export const meta: ActionMeta = {
  label: 'CC: Dir Ops',
  description: 'Dispatcher for directory cc- commands (add-dir, set-dir)',
  category: 'claude-code',
  input: {
    command: { type: 'string', required: true },
    text: { type: 'string', required: false },
    threadId: { type: 'string', required: false },
    references: { type: 'object', required: false },
  },
};

type Handler = (
  args: string[],
  services: Services,
  threadId?: string,
) => Promise<{ text: string; data?: any }>;

/** Rejoin path arguments after quote parsing, excluding command flags. */
function parseDirPath(args: string[]): string {
  return args.filter(a => !a.startsWith('--')).join(' ');
}

/** Shorten a path to at most the last 2 segments for display. */
function shortenPath(p: string): string {
  const s = p.split('/').filter(Boolean);
  return s.length <= 2 ? p : `…/${s.slice(-2).join('/')}`;
}

const handlers: Record<string, Handler> = {
  'add-dir': handleAddDir,
  'set-dir': handleSetDir,
};

export async function action(
  params: Record<string, any>,
  services: Services,
  _z: Z,
  _flowId: string,
) {
  const { command, text, threadId } = params;
  const name = (command as string).replace(/^cc-/, '');

  const handler = handlers[name];
  let success = !!handler;
  let result: { text: string; data?: any; skipMessage?: boolean };

  if (handler) {
    try {
      const args = parseCommandArguments(text ?? '');
      result = await handler(args, services, threadId);
    } catch (error: any) {
      success = false;
      result = { text: `cc-${name} failed: ${error?.message || 'Unknown error'}` };
    }
  } else {
    result = { text: `Unknown dir command: cc-${name}` };
  }

  if (threadId && !result.skipMessage) {
    services.chat.sendBlockMessage({ threadId, text: result.text, blocks: [] });
  }

  return { success, command: `cc-${name}`, text: result.text, data: result.data };
}

// ── Handlers ────────────────────────────────────────────────────────

async function handleAddDir(
  args: string[],
  services: Services,
  threadId?: string,
): Promise<{ text: string; data?: any }> {
  if (!args.length) return { text: 'Usage: /cc-add-dir <path> [--remember]' };

  const remember = args.includes('--remember');
  const dirPath = parseDirPath(args);
  if (!dirPath) return { text: 'Usage: /cc-add-dir <path> [--remember]' };

  // A failed remembered-settings edit must not change the thread's next launch roots.
  if (remember) {
    const settings = await services.cli.claudeCode.readSettings();
    const perms = settings.permissions ?? {};
    const dirs: string[] = perms.additionalDirectories ?? [];
    if (!dirs.includes(dirPath)) {
      perms.additionalDirectories = [...dirs, dirPath];
      settings.permissions = perms;
      await services.cli.claudeCode.writeSettings(settings);
    }
  }

  if (threadId) {
    const state = getClaudeState(services, threadId);
    const existing = state?.additionalDirs ?? [];
    if (!existing.includes(dirPath)) {
      persistClaudeState(services, threadId, {
        additionalDirs: [...existing, dirPath],
      });
      updateClaudeState(services, threadId as any, (prev: any) => ({
        additionalDirs: [...new Set([...(prev.additionalDirs ?? []), dirPath])],
      }));
    }
  }

  const suffix = remember ? ' (remembered across sessions)' : ' (this session only)';
  return { text: `Added directory: ${dirPath}${suffix}` };
}

async function handleSetDir(
  args: string[],
  services: Services,
  threadId?: string,
): Promise<{ text: string }> {
  const dirPath = parseDirPath(args);
  if (!dirPath) return { text: 'Usage: /cc-set-dir <path>' };

  setProjectDirectory(services, dirPath);

  if (threadId) {
    const state = getClaudeState(services, threadId);
    if (state?.sessionId) {
      const topic = `New session — ${shortenPath(dirPath)}`;
      const { id: newThreadId } = services.chat.createThreadAndNotify({
        topic,
        instructions: '',
      });
      services.chat.openThreadChatAndRefreshRecent(newThreadId as any);
      return { text: `Working directory set to: ${dirPath} (new thread created)` };
    }
  }

  return { text: `Working directory set to: ${dirPath}` };
}
