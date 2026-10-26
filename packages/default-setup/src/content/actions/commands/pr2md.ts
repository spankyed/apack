import type { ActionMeta } from '@apackdev/sdk/build';
import type { Services, Z } from '#generated/services.ts';

export const meta: ActionMeta = {
  label: 'PR to Markdown',
  description: 'Renders PR comments and review threads to a local markdown file',
  category: 'commands',
  input: {
    text: { type: 'string', description: 'PR number or GitHub PR URL', required: false },
    threadId: { type: 'string', description: 'Thread ID for feedback', required: false },
    references: { type: 'object', description: 'Attached references (images, files, context)', required: false },
  },
};

function parseArg(text: string): { number: number; repo?: { owner: string; name: string } } | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const urlMatch = trimmed.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
  if (urlMatch) {
    return {
      number: parseInt(urlMatch[3], 10),
      repo: { owner: urlMatch[1], name: urlMatch[2] },
    };
  }

  const num = parseInt(trimmed, 10);
  if (!isNaN(num)) return { number: num };

  return null;
}

function formatDate(iso: string): string {
  return iso.slice(0, 10);
}

function formatReviewThreads(threads: any[]): string {
  if (threads.length === 0) return '';

  const lines: string[] = [`## Review Threads (${threads.length})`];

  for (const thread of threads) {
    const status = thread.isResolved ? 'resolved' : 'active';
    const location = thread.startLine && thread.line
      ? `${thread.path}:${thread.startLine}-${thread.line}`
      : thread.line
        ? `${thread.path}:${thread.line}`
        : thread.path;
    lines.push(`### ${location} (${status})`);

    const diffHunk = thread.diffHunk || thread.comments?.find((c: any) => c.diffHunk)?.diffHunk;
    if (diffHunk) {
      lines.push('', '```diff', diffHunk, '```', '');
    }

    for (let i = 0; i < thread.comments.length; i++) {
      const c = thread.comments[i];
      if (i === 0) {
        lines.push(`**@${c.author.login}** — ${formatDate(c.createdAt)}`);
        lines.push(c.body);
      } else {
        lines.push(`> **@${c.author.login}** — ${formatDate(c.createdAt)}`);
        lines.push(c.body.split('\n').map((l: string) => `> ${l}`).join('\n'));
      }
      lines.push('');
    }
  }

  return lines.join('\n');
}

function formatPRMarkdown(pr: any, comments: any[], threads: any[]): string {
  const lines: string[] = [
    `# PR #${pr.number}: ${pr.title}`,
    `**Branch:** ${pr.headRefName} → ${pr.baseRefName} | **Author:** @${pr.author.login} | **Status:** ${pr.state}${pr.isDraft ? ' (Draft)' : ''}`,
    `**URL:** ${pr.url}`,
    '',
  ];

  if (pr.body?.trim()) {
    lines.push('## Description', pr.body.trim(), '');
  }

  if (comments.length > 0) {
    lines.push(`## Comments (${comments.length})`);
    for (const c of comments) {
      lines.push(`### @${c.author.login} — ${formatDate(c.createdAt)}`);
      lines.push(c.body, '');
    }
  }

  const threadsMd = formatReviewThreads(threads);
  if (threadsMd) {
    lines.push(threadsMd);
  }

  return lines.join('\n');
}

export async function action(
  params: Record<string, any>,
  services: Services,
  _z: Z,
  _flowId: string,
) {
  const { text, threadId } = params;

  try {
    const parsed = text ? parseArg(text) : null;
    let pr: any;
    let repo: { owner: string; name: string } | undefined;

    if (parsed) {
      repo = parsed.repo;
      pr = await services.cli.gh.getPRDetails(parsed.number, repo);
    } else {
      const branchPR = await services.cli.gh.findPRForBranch();
      if (!branchPR) {
        const branch = await services.cli.git.getCurrentBranch();
        if (threadId) {
          services.chat.sendBlockMessage({
            threadId,
            text: `No PR found for branch "${branch}"`,
            blocks: [],
          });
        }
        return { success: false, error: 'No PR found for current branch' };
      }
      pr = await services.cli.gh.getPRDetails(branchPR.number);
    }

    const threads = await services.cli.gh.getReviewThreads(pr.number, repo);
    const markdown = formatPRMarkdown(pr, pr.comments || [], threads);

    if (threadId) {
      services.artifact.create({
        artifactType: 'markdown',
        title: `PR #${pr.number}: ${pr.title}`,
        content: markdown,
        threadId: threadId as any,
      });
      services.chat.sendBlockMessage({
        threadId,
        text: `PR #${pr.number} exported to artifacts`,
        blocks: [],
      });
    }

    return { success: true, prNumber: pr.number };
  } catch (error: any) {
    const errorMsg = error?.message || 'Failed to fetch PR';
    if (threadId) {
      services.chat.sendBlockMessage({
        threadId,
        text: `pr2md failed: ${errorMsg}`,
        blocks: [],
      });
    }
    return { success: false, error: errorMsg };
  }
}
