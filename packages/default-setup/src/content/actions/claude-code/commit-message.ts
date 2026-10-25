/**
 * CC: Commit Message — generates a commit message from a git diff using Claude CLI.
 *
 * Triggered by the `commit.generate` brain event (forwarded from the
 * code system's generateCommitMessage handler).
 */

import type { ActionMeta } from '@apackdev/sdk/build';
import type { Services, Z } from '#generated/services.ts';
import { formatProviderError } from '../_helpers/format-provider-error.ts';

export const meta: ActionMeta = {
  label: 'CC: Commit Message',
  description: 'Generate a git commit message from a diff using Claude CLI',
  category: 'claude-code',
  input: {
    client: { type: 'string', description: 'The connection of the window that asked, which the result answers alone' },
    diff: { type: 'string', description: 'Git diff to generate a commit message from', required: true },
    branch: { type: 'string', description: 'Current branch name', required: false },
    repoName: { type: 'string', description: 'Repository name', required: false },
  },
};

/**
 * Clean up model output into a usable commit message.
 * Strips markdown fences, preamble prose, surrounding quotes,
 * and enforces 72-char subject line.
 */
function postprocess(raw: string): string {
  let msg = raw.trim();

  // Strip markdown code fences
  msg = msg.replace(/^```(?:\w+)?\n?/, '').replace(/\n?```$/, '').trim();

  // Strip preamble like "Here is a commit message:" or "Sure, here's..."
  msg = msg.replace(/^(?:here(?:'s| is) (?:a |the )?(?:commit )?message[:\s]*)/i, '').trim();
  msg = msg.replace(/^(?:sure[,!.]?\s*)/i, '').trim();

  // Strip surrounding quotes
  if ((msg.startsWith('"') && msg.endsWith('"')) || (msg.startsWith("'") && msg.endsWith("'"))) {
    msg = msg.slice(1, -1).trim();
  }

  // Strip Co-Authored-By trailers
  msg = msg.replace(/\n*Co-Authored-By:.*$/gim, '').trim();

  return msg;
}

export async function action(
  params: Record<string, any>,
  services: Services,
  _z: Z,
  _flowId: string,
) {
  const { diff, branch, repoName, client } = params;
  // The window that asked: a flow run has no return address, so the ask carried its connection. With none, no
  // window asked, and there is nobody to tell what this would make
  if (!client) return { success: false, error: 'No window asked' };

  if (!diff?.trim()) {
    services.emitter.sendToWindow(client, 'default-setup/code', {
      type: 'commit.ERROR_RECEIVED',
      data: { message: 'No diff provided' },
    });
    return { success: false, error: 'Empty diff' };
  }

  services.emitter.sendToWindow(client, 'default-setup/code', { type: 'commit.GENERATING_MESSAGE' });

  try {
    const fullPrompt = services.prompt.usePrompt('Commit Message', {
      diff,
      branch: branch || '',
      repoName: repoName || '',
    });

    if (!fullPrompt) {
      services.emitter.sendToWindow(client, 'default-setup/code', {
        type: 'commit.ERROR_RECEIVED',
        data: { message: 'Commit Message prompt template not found. Import the pack content.' },
      });
      return { success: false, error: 'Prompt not found' };
    }

    const result = await services.cli.claudeCode.exec(
      ['-p', fullPrompt, '--system-prompt', 'Output ONLY the commit message. No preamble, no markdown, no backticks, no quotes.'],
      { timeoutMs: 60_000, cwd: '/tmp' },
    );

    const message = postprocess(result.stdout);

    if (!message) {
      services.emitter.sendToWindow(client, 'default-setup/code', {
        type: 'commit.ERROR_RECEIVED',
        data: { message: 'Claude returned an empty response.' },
      });
      return { success: false, error: 'Empty response' };
    }

    services.emitter.sendToWindow(client, 'default-setup/code', {
      type: 'commit.MESSAGE_GENERATED',
      data: { message },
    });

    return { success: true };
  } catch (error: any) {
    const errorMessage = formatProviderError(error, 'Claude Code');
    services.emitter.sendToWindow(client, 'default-setup/code', {
      type: 'commit.ERROR_RECEIVED',
      data: { message: errorMessage },
    });
    return { success: false, error: errorMessage };
  }
}
