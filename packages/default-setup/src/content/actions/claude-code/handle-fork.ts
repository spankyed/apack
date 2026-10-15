/** Initialize the selected native history on a new app fork, with no fallback to another boundary. */
import type { ActionMeta } from '@apackdev/sdk/build';
import type { Services, EntityId } from '#generated/services.ts';
import { getClaudeState, persistClaudeState, dequeueMessage } from './_helpers/thread-context.ts';
import { replayQueuedMessage } from './_helpers/stream-consumer.ts';

export const meta: ActionMeta = {
  label: 'CC: Handle Fork',
  description: 'Copies Claude Code session state to a forked thread with CLI-level truncation at the fork point.',
  category: 'claude-code',
  input: {
    sourceThreadId: { type: 'string', description: 'Original thread ID', required: true },
    newThreadId: { type: 'string', description: 'Forked thread ID', required: true },
    sourceMessageId: { type: 'string', description: 'Message ID at the fork point', required: false },
  },
};

export async function action(params: Record<string, any>, services: Services) {
  const {sourceThreadId,newThreadId,sourceMessageId} = params as {sourceThreadId:string;newThreadId:string;sourceMessageId?:string};
  const fail = (reason:string) => {
    if (newThreadId) {
      persistClaudeState(services,newThreadId,{forkPending:undefined,historyError:reason});
      services.chat.sendBlockMessage({threadId:newThreadId as EntityId,text:`Could not prepare fork: ${reason} Reset or resume a session before continuing.`,blocks:[],forkable:false});
    }
    return {success:false,copied:false,reason};
  };
  if (!sourceThreadId || !newThreadId) return fail('The fork source or target is unavailable.');
  const source = getClaudeState(services,sourceThreadId);
  const readSnapshot = () => JSON.stringify({state:getClaudeState(services,sourceThreadId),
    messages:services.repository.chatQueries.threadData(sourceThreadId as EntityId)?.messages?.map(message=>[message.id,message.context?.cliUuid])});
  const snapshot = readSnapshot();
  if (!source?.sessionId) {
    const nativeMessages=services.repository.chatQueries.threadData(sourceThreadId as EntityId)?.messages?.some(message=>message.context?.cliUuid);
    if (nativeMessages) return fail('The native session for this history is unavailable.');
    persistClaudeState(services,newThreadId,{forkPending:undefined,historyError:undefined});
    const queued=dequeueMessage(services,newThreadId);
    if (queued) await replayQueuedMessage(services,newThreadId as EntityId,queued,services.logger);
    return {success:true,copied:false};
  }
  if (source.historyError && !sourceMessageId) return fail('Select a valid checkpoint or reset/resume the source before forking its whole session.');
  if (!source.cwd) return fail('The native session project directory is unavailable.');
  if (source.isRunning || services.cli.claudeCode.getHandle(sourceThreadId)) return fail('Pause the source turn before forking.');
  let cliUuid:string|undefined;
  if (sourceMessageId) {
    const messages=services.repository.chatQueries.threadData(sourceThreadId as EntityId)?.messages ?? [];
    const index=messages.findIndex(message=>message.id===sourceMessageId);
    if (index<0) return fail('The selected fork message is unavailable.');
    const assistant=[...messages.slice(0,index+1)].reverse().find(message=>message.sender==='assistant'&&typeof message.context?.cliUuid==='string');
    cliUuid=assistant?.context?.cliUuid as string|undefined;
    if (!cliUuid) return fail('No native assistant checkpoint exists at this fork point.');
  }
  try {
    if (cliUuid) await services.cli.claudeCode.validateResumeTarget({sessionId:source.sessionId,messageUuid:cliUuid,cwd:source.cwd});
    else await services.cli.claudeCode.getContextUsage({sessionId:source.sessionId,cwd:source.cwd});
  } catch (error:any) { return fail(error?.message ?? 'The native history boundary is unavailable.'); }
  if (snapshot!==readSnapshot() || services.cli.claudeCode.getHandle(sourceThreadId)) return fail('The source conversation changed during validation. Retry the fork.');
  persistClaudeState(services,newThreadId,{sessionId:source.sessionId,cwd:source.cwd,sessionWorktree:source.sessionWorktree,
    lastTurnAt:source.lastTurnAt,forkFrom:{sessionId:source.sessionId,cliUuid},forkPending:undefined,historyError:undefined});
  const queued=dequeueMessage(services,newThreadId);
  if (queued) await replayQueuedMessage(services,newThreadId as EntityId,queued,services.logger);
  return {success:true,copied:true,sessionId:source.sessionId,cliUuid};
}
