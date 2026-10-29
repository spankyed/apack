import type { Services, EntityId } from '#generated/services.ts';
import type { QueryHandle } from '#features/code/be/services/claude-code/query.ts';
import { persistClaudeState, setRunning, updateChatState } from './thread-context.ts';
/** Keep explicit HTTP(S) navigation free of credentials and parser-ambiguous controls. */
export function mcpElicitationUrl(value: unknown): string | undefined {
  // eslint-disable-next-line no-control-regex -- Intentionally reject control characters before navigation.
  if (typeof value !== 'string' || value.length > 8192 || /[\u0000-\u0020\u007f\\]/.test(value)) return undefined;
  return /^https?:\/\/[^\s\\/@?#]+(?:[/?#][^\s\\]*)?$/i.test(value) ? value : undefined;
}

/** Present this original request in its own response channel, never as a tool approval. */
export function presentMcpElicitation(services: Services, threadId: EntityId, handle: QueryHandle, requestId: string, request: Record<string, unknown>): boolean {
  const serverName = typeof request.mcp_server_name === 'string' ? request.mcp_server_name : 'unknown';
  const message = [typeof request.title === 'string' ? request.title : '',
    `MCP server ${serverName}${typeof request.display_name === 'string' ? ` (${request.display_name})` : ''} requests input: ${typeof request.message === 'string' ? request.message : ''}`,
    typeof request.description === 'string' ? request.description : '',
  ].filter(Boolean).join('\n');
  if (request.mode !== 'url' && request.mode !== 'form') {
    handle.respondElicitation(requestId, { action: 'cancel' });
    services.chat.sendBlockMessage({ threadId, text: 'The MCP server requested an unsupported input mode. The request was cancelled.', blocks: [], forkable: false });
    return false;
  }
  let form;
  if (request.mode === 'form') {
    try { form = services.cli.claudeCode.parseMcpElicitationForm(request.requested_schema, Array.isArray(request.property_order) ? request.property_order.filter((value): value is string => typeof value === 'string') : undefined); }
    catch {
      handle.respondElicitation(requestId, { action: 'cancel' });
      services.chat.sendBlockMessage({ threadId, text: `MCP server ${serverName} requested an unsupported form schema. The request was cancelled.`, blocks: [], forkable: false });
      return false;
    }
  }
  const url = request.mode === 'url' ? mcpElicitationUrl(request.url) : undefined;
  if (request.mode === 'url' && !url) {
    handle.respondElicitation(requestId, { action: 'cancel' });
    services.chat.sendBlockMessage({ threadId, text: 'The MCP input request contained an unsupported URL and was cancelled.', blocks: [], forkable: false });
    return false;
  }
  const blocks = form ? [{ type: 'mcp-elicitation', props: { form } }] : [
    { type: 'prompt', props: { content: 'Open the requested page to complete the request, then confirm. Nothing opens automatically.' } },
    { type: 'link', props: { links: [{ label: url, icon: 'external-link', event: { target: 'external', data: { url } } }] } },
    { type: 'button-group', props: { buttons: [{ id: 'accept', label: 'Completed', variant: 'primary' }, { id: 'decline', label: 'Decline', variant: 'secondary' }, { id: 'cancel', label: 'Cancel', variant: 'secondary' }] } },
  ];
  const prompt = services.chat.sendBlockMessage({ threadId, text: message, blocks, forkable: false, autoHide: true, asUser: true });
  persistClaudeState(services, threadId, { pendingElicitation: { requestId, approvalMessageId: prompt.messageId, ownerPid: handle.pid, serverName, mode: request.mode, form, message } });
  setRunning(services, threadId, false);
  updateChatState(services, threadId, 'paused');
  return true;
}
