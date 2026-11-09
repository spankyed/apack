import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { importCompiledContent } from '@apackdev/sdk/utils';
import { importFlows, mockService, startApp } from '@apackdev/testing/harness';
import { services, type Services } from '#generated/services.ts';
import { repository } from '#generated/repository.ts';
import { claudeCode } from '#features/code/be/services/claude-code/index.ts';
import * as runner from '#features/code/be/services/claude-code/runner.ts';
import * as store from '#features/code/be/services/claude-code/handle-store.ts';
import type { ResultLine, StreamLine } from '#features/code/be/services/claude-code/types.ts';
import { getClaudeState } from '../../../../../../src/content/actions/claude-code/_helpers/thread-context.ts';
import { actionLabel } from '../../../../../_support/flows.ts';

const executable = process.env.CLAUDE_RESEARCH_EXECUTABLE;
const workspace = process.env.CLAUDE_RESEARCH_WORKSPACE;
const endpoint = process.env.CLAUDE_RESEARCH_MODEL_URL;

// Explicit private native probe only; normal suites never launch a user's configured Claude.
it.skipIf(!executable || !workspace || !endpoint)('compiled app owns native approval, idle scheduling and the next host input', async () => {
  expect(process.env.HOME).toBe(workspace);
  for (const key of ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN']) expect(process.env[key]).toBeUndefined();
  const url = new URL(endpoint!);
  expect(url.protocol).toBe('http:'); expect(url.hostname).toBe('127.0.0.1');
  const nativeEvents: StreamLine[] = [];
  const results: ResultLine[] = [];
  let sent: ReturnType<typeof vi.spyOn> | undefined;
  const spawning = vi.spyOn(runner, 'spawnStream');
  vi.stubEnv('ANTHROPIC_BASE_URL', endpoint!);
  vi.stubEnv('CLAUDE_CODE_SIMPLE', undefined);
  vi.stubEnv('CLAUDE_CODE_COORDINATOR_MODE', undefined);
  vi.stubEnv('TZ', 'UTC');
  await mkdir(join(workspace!, '.claude'), { recursive: true });
  await writeFile(join(workspace!, '.claude', 'settings.json'), JSON.stringify({ apiKeyHelper: '/usr/bin/printf research-fixture-key' }));
  services.settings.set({ kind: 'feature', featureRef: 'default-setup/code' }, ['cliPaths', 'claude-code'], executable!);
  const originalQuery = claudeCode.query.bind(claudeCode);
  vi.spyOn(claudeCode, 'query').mockImplementation(async options => {
    const handle = await originalQuery({ ...options, signal: AbortSignal.timeout(145000) });
    sent = vi.spyOn(handle, 'send');
    return handle;
  });
  const original = services.cli.claudeCode;
  const opened = vi.fn<Services['cli']['claudeCode']['openConversation']>((...args) =>
    original.openConversation(...args).then(owner => {
      owner.subscribe(event => { nativeEvents.push(event); if (event.type === 'result') results.push(event as ResultLine); });
      return owner;
    }));
  mockService<Services, 'cli'>('cli', { claudeCode: { ...original, openConversation: opened } });
  const compiledDir = resolve(import.meta.dirname, '../../../../../../dist/runtime/content');
  importCompiledContent({ compiledDir, include: { flows: new Set(), library: new Set(), notes: new Set(), settings: new Set() } });
  const flows = JSON.parse(readFileSync(join(compiledDir, 'flows.content.json'), 'utf8'));
  importFlows({ 'Claude Code': { ...flows['Claude Code'], root: true } });
  const app = await startApp({ systems: ['brain'] });
  await app.runFlow('Claude Code');
  const { id } = repository.threadCommands.create({ topic: 'Native scheduling fixture', instructions: '', tags: [] });
  repository.threadCommands.update(id, { context: { claudeCode: { cwd: workspace! } } });
  const state = () => getClaudeState(services, id);
  const messages = () => repository.chatQueries.threadData(id)?.messages ?? [];
  try {
    const first = repository.chatCommands.addMessage({ threadId: id, sender: 'user', text: 'Create the disposable one-shot scheduling fixture, after the synthetic question.' });
    const run = await app.runFlow('Claude Code', { event: 'user.message', data: { threadId: id, text: first.text, messageId: first.id, mode: 'Claude Code' } });
    expect(run.steps.map(actionLabel)).toContain('Claude Code Chat');
    await vi.waitFor(() => expect(state()?.pendingControlRequest?.toolName).toBe('AskUserQuestion'), { timeout: 15000 });
    const pending = state()!.pendingControlRequest!;
    const nativeRequest = nativeEvents.find(event => event.type === 'control_request' && event.request_id === pending.requestId);
    expect(nativeRequest).toBeDefined();
    expect(messages().find(message => message.id === pending.approvalMessageId)?.blocks).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'question' })]));
    const answered = await app.runFlow('Claude Code', { event: 'interactive.message.response', data: { threadId: id, messageId: pending.approvalMessageId, response: 'Alpha' } });
    expect(answered.steps.map(actionLabel).filter(Boolean)).toEqual(['CC: Route Response', 'CC: Answer Question']);
    await vi.waitFor(() => expect(state()?.turns === 1 || state()?.pendingControlRequest?.toolName === 'CronCreate').toBe(true), { timeout: 15000 });
    let schedulingApprovals = 0;
    if (state()?.pendingControlRequest?.toolName === 'CronCreate') {
      const scheduling = state()!.pendingControlRequest!;
      expect(scheduling.originalInput?.prompt).toBe('Synthetic scheduling fixture. Do not execute.');
      await app.runFlow('Claude Code', { event: 'interactive.message.response', data: { threadId: id, messageId: scheduling.approvalMessageId, response: { approved: true } } });
      schedulingApprovals++;
    }
    await vi.waitFor(() => expect(state()?.turns).toBe(1), { timeout: 15000 });
    await vi.waitFor(() => expect(store.isConversationBusy(id)).toBe(false));
    const owner = store.getConversation(id)!.owner;
    const session = state()!.sessionId;
    expect(store.getHandle(id)).toBe(owner.handle);
    expect(owner.closing).toBe(false);
    expect(state()?.pendingControlRequest).toBeUndefined();
    expect(nativeEvents.some(event => event.type === 'assistant' && JSON.stringify(event).includes('"name":"CronCreate"'))).toBe(true);
    expect(messages().find(message => message.id === first.id)?.context?.cliUuid).toBe(results[0]!.user_message_uuid);
    const countBeforeUi = messages().length;
    const client = { client_id: 'research-app-owner', surface: 'desktop' as const };
    expect((await owner.handle.ui.attach(client)).surfaces).toEqual(['desktop']);
    expect(await owner.handle.ui.render({ ...client, component: 'AbovePrompt', instance_id: 'app-owner-above', props: {} })).toHaveProperty('tree');
    expect(messages()).toHaveLength(countBeforeUi);
    await vi.waitFor(() => expect(state()?.turns).toBe(2), { timeout: 120000, interval: 25 });
    await vi.waitFor(() => expect(store.isConversationBusy(id)).toBe(false));
    expect(store.getConversation(id)?.owner).toBe(owner);
    expect(sent).toHaveBeenCalledOnce();
    expect(state()?.sessionId).toBe(session);
    expect(messages().find(message => message.id === first.id)?.context?.cliUuid).toBe(results[0]!.user_message_uuid);
    const second = repository.chatCommands.addMessage({ threadId: id, sender: 'user', text: 'Continue with the synthetic text-only follow-up.' });
    await app.runFlow('Claude Code', { event: 'user.message', data: { threadId: id, text: second.text, messageId: second.id, mode: 'Claude Code' } });
    await vi.waitFor(() => expect(state()?.turns).toBe(3), { timeout: 15000 });
    await vi.waitFor(() => expect(store.isConversationBusy(id)).toBe(false));
    expect(opened).toHaveBeenCalledOnce(); expect(spawning).toHaveBeenCalledOnce(); expect(sent).toHaveBeenCalledTimes(2);
    const args = spawning.mock.calls[0]![0];
    for (const flag of ['--tools', '--setting-sources', '--strict-mcp-config']) expect(args).not.toContain(flag);
    expect(results).toHaveLength(3); expect(results.every(result => result.subtype === 'success' && result.session_id === session)).toBe(true);
    expect(messages().find(message => message.id === second.id)?.context?.cliUuid).toBe(results[2]!.user_message_uuid);
    expect(Math.abs(state()!.totalCostUsd! - results[2]!.total_cost_usd!)).toBeLessThan(1e-12);
    expect(messages().filter(message => message.sender === 'assistant' && message.text === 'Fixture completed.').length).toBeGreaterThanOrEqual(3);
    await owner.handle.ui.detach(client.client_id);
    expect(await store.closeIdleConversation(id)).toBe(true); expect(store.getHandle(id)).toBeUndefined();
    await writeFile(join(workspace!, 'app-owner-evidence.json'), JSON.stringify({ compiledFlow: true, productionLaunchService: true, defaultToolPool: true, questionRoundTrip: true, schedulingApprovals,
      idleProcessRetained: true, autonomousTurn: true, nextHostInput: true, singleNativeProcess: true, hostInputs: 2, appTurns: 3,
      canonicalUserMappings: true, idleUiDidNotCreateMessage: true, exactCostAccounting: true, nativeCumulativeCosts: results.map(result => result.total_cost_usd),
      appTotalCostUsd: state()!.totalCostUsd, closed: true }, null, 2));
  } finally { store.killAllHandles(); }
}, 150000);
