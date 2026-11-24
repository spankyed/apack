/**
 * Claude Code List Sessions — returns on-disk sessions for a cwd.
 *
 * Intended for UI dropdowns ("resume which session?") and diagnostic
 * flows. Reads directly from the CLI's JSONL storage under
 * `$CLAUDE_CONFIG_DIR/projects/<encoded-cwd>/*.jsonl` (handled by the
 * wrapper).
 */

import type { ActionMeta } from '@apackdev/sdk/build';
import type { Services } from '#generated/services.ts';

export const meta: ActionMeta = {
  label: 'Claude Code List Sessions',
  description: 'List saved Claude Code sessions for a working directory.',
  category: 'claude-code',
  input: {
    cwd: { type: 'string', description: 'Working directory whose sessions to list', required: false },
    limit: { type: 'number', description: 'Max sessions to return', required: false },
    offset: { type: 'number', description: 'Pagination offset', required: false },
  },
};

export async function action(
  params: Record<string, any>,
  services: Services,
) {
  const { cwd, limit, offset } = params as {
    cwd?: string;
    limit?: number;
    offset?: number;
  };

  try {
    const sessions = await services.cli.claudeCode.listSessions({ cwd, limit, offset });
    return {
      success: true,
      sessions: sessions.map((s) => ({
        id: s.id,
        cwd: s.cwd,
        file: s.file,
        size: s.size,
        modifiedAt: s.modifiedAt instanceof Date ? s.modifiedAt.toISOString() : s.modifiedAt,
        title: s.title,
        tags: s.tags,
      })),
    };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Failed to list Claude Code sessions' };
  }
}
