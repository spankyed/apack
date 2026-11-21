import type { EntityId } from '#generated/services.ts';
import { repository } from '#generated/repository.ts';
import { projectClaudeTerminalHistory } from './claude-terminal-history.ts';
const object = (value: unknown): Record<string, unknown> | undefined => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;

/** Import canonical native rows without acquiring or persisting live drawing capabilities. */
export function importClaudeSessionMessages({threadId, transcript, sessionId}: {threadId: EntityId; transcript: readonly Record<string, unknown>[]; sessionId: string}): number {
  const results = new Map<string, {row: Record<string, unknown>; block: Record<string, unknown>}>();
  for (const row of transcript) {
    const content = object(row.message)?.content;
    if (row.sessionId !== sessionId || row.type !== 'user' || row.isSidechain === true || row.agentId !== undefined || !Array.isArray(content)) continue;
    for (const value of content) {
      const block = object(value);
      if (block?.type === 'tool_result' && typeof block.tool_use_id === 'string') results.set(block.tool_use_id, {row, block});
    }
  }
  let imported = 0;
  for (const entry of transcript) {
    const row = projectClaudeTerminalHistory({sessionId, row: entry});
    if (!row) continue;
    for (const block of row.blocks) {
      if (block.type !== 'tool-activity') continue;
      for (const tool of block.props.entries) {
        const saved = results.get(tool.id), resultRow = saved?.row, result = saved?.block;
        if (result) {
          const text = typeof result.content === 'string' ? result.content : Array.isArray(result.content) ? result.content.map(object).filter(value => value?.type === 'text').map(value => value?.text).join('\n') : '';
          tool.status = result.is_error === true ? 'error' : 'ok';
          tool.outputSummary = text.slice(0, 200); tool.details = {...tool.details, output: text};
          if (typeof resultRow?.uuid === 'string') tool.nativeResult = {uuid: resultRow.uuid, sessionId};
        } else {
          tool.status = 'error'; tool.details = {...tool.details, error: 'Saved session has no recorded result'};
        }
      }
      block.props.state = block.props.entries.some((tool: {status: string}) => tool.status === 'error') ? 'error' : 'done';
    }
    const timestamp = typeof entry.timestamp === 'string' ? Date.parse(entry.timestamp) : Number.NaN;
    const message = repository.chatCommands.addMessage({...(Number.isFinite(timestamp) ? {timestamp} : {}), threadId, sender: row.sender, text: row.text, blocks: row.blocks, context: row.context, references: row.references, forkable: row.sender === 'assistant', skipRelink: true});
    if (message.text !== row.text) repository.chatCommands.updateMessageState({messageId: message.id, updates: {text: row.text}});
    imported++;
  }
  return imported;
}
