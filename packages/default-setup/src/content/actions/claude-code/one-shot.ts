/**
 * Claude Code One-Shot — programmatic query with no chat side-effects.
 *
 * Useful for other flows that want "ask Claude Code a question and use the
 * answer as a variable" — e.g. a commit-message generator, a code-review
 * step, or a structured-output extractor. No message is posted, no tag is
 * applied, no thread state is touched.
 */

import type { ActionMeta } from '@apackdev/sdk/build';
import type { Services } from '#generated/services.ts';

export const meta: ActionMeta = {
  label: 'Claude Code One-Shot',
  description: 'Run a single Claude Code prompt without touching any thread. Returns the final text and optional structured output.',
  category: 'claude-code',
  input: {
    prompt: { type: 'string', description: 'The user prompt', required: true },
    cwd: { type: 'string', description: 'Working directory override', required: false },
    model: { type: 'string', description: 'Claude model (alias or full id)', required: false },
    allowedTools: { type: 'array', description: 'Tools allowed without prompting', required: false },
    systemPrompt: { type: 'string', description: 'System prompt override', required: false },
    jsonSchema: { type: 'string', description: 'JSON Schema for structured output (stringified)', required: false },
  },
};

export async function action(
  params: Record<string, any>,
  services: Services,
) {
  const { prompt, cwd, model, allowedTools, systemPrompt, jsonSchema } = params as {
    prompt: string;
    cwd?: string;
    model?: string;
    allowedTools?: string[];
    systemPrompt?: string;
    jsonSchema?: string | object;
  };

  if (!prompt?.trim()) {
    return { success: false, error: 'prompt is required' };
  }

  let parsedSchema: unknown = undefined;
  if (jsonSchema) {
    try {
      parsedSchema = typeof jsonSchema === 'string' ? JSON.parse(jsonSchema) : jsonSchema;
    } catch (err: any) {
      return { success: false, error: `invalid jsonSchema: ${err?.message || 'parse error'}` };
    }
  }

  try {
    const handle = await services.cli.claudeCode.query({
      prompt,
      cwd,
      model,
      permissionMode: 'default',
      // Default to read-only so one-shots can't silently mutate the workspace.
      allowedTools: allowedTools ?? ['Read', 'Glob', 'Grep'],
      systemPrompt,
      jsonSchema: parsedSchema,
      noSessionPersistence: true,
    });

    // Drain events to completion so the child exits cleanly.
    // No timeout — the CLI process will eventually exit or be killed externally.
    // One-shot callers needing a timeout should set AbortSignal on query opts.
    for await (const _ev of handle.events) { /* no-op */ }

    const result = await handle.result;
    return {
      success: true,
      text: result.text,
      structuredOutput: result.structuredOutput,
      sessionId: result.sessionId,
      costUsd: result.totalCostUsd,
      durationMs: result.durationMs,
    };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Claude Code one-shot failed' };
  }
}
