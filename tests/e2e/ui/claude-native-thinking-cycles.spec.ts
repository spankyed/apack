import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test, expect } from '@apackdev/testing';

const workspace = process.env.CLAUDE_RESEARCH_WORKSPACE;
const launcher = process.env.CLAUDE_RESEARCH_LAUNCHER;
const endpoint = process.env.CLAUDE_RESEARCH_MODEL_URL;
test.skip(!workspace || !launcher || !endpoint, 'Explicit private native research fixture required');

test('native thinking survives two real tool cycles in one app turn', async ({ app, appPage }, testInfo) => {
  expect(process.env.HOME).toBe(workspace);
  expect(new URL(endpoint!).hostname).toBe('127.0.0.1');
  const errors: string[] = [];
  appPage.on('pageerror', error => errors.push(error.message));
  await app.waitForPlugin('default-setup/threads');
  await app.navigate('default-setup/threads');
  await expect.poll(() => appPage.evaluate(() => (window as any).applicationState.system.get('default-setup/threads').getSnapshot().context.currentThread?.forcedMode)).toBe('Birth');
  await app.navigate('host/settings');
  await appPage.evaluate(() => {
    const settings = (window as any).applicationState.system.get('host/settings');
    settings.send({ type: 'TAB.SELECT', tab: 'general' });
    settings.send({ type: 'GENERAL_NAV.SELECT', item: 'secrets' });
  });
  const provider = appPage.getByText('Claude Code CLI', { exact: true }).locator('..').locator('..').locator('..');
  await provider.getByPlaceholder('Path override (auto-detected if empty)').fill(launcher!);
  // CLI paths save after the form's 600ms debounce; remount to verify persisted state.
  await appPage.waitForTimeout(700);
  await app.navigate('default-setup/threads');
  await app.navigate('host/settings');
  await expect(provider.getByPlaceholder('Path override (auto-detected if empty)')).toHaveValue(launcher!);
  await app.navigate('default-setup/threads');
  await appPage.evaluate(cwd => {
    const threads = (window as any).applicationState.system.get('default-setup/threads');
    threads.send({ type: 'NEW_THREAD_IN_PROJECT', directory: cwd });
    threads.send({ type: 'VIEW_DASHBOARD' });
    threads.send({ type: 'SET_MODE', mode: 'Claude Code' });
    threads.send({ type: 'SET_PHASE', phase: 'Edit' });
  }, workspace!);
  const card = appPage.locator('[data-onboarding-id="agent-chat-input"]');
  const editor = card.locator('[contenteditable="true"]');
  await expect(editor).toBeVisible();

  const snapshot = () => appPage.evaluate(() => {
    const thread = (window as any).applicationState.system.get('default-setup/threads').getSnapshot().context.currentThread;
    return { id: thread.id, turns: thread.context?.claudeCode?.turns, tools: thread.context?.claudeCode?.toolCallCount, messages: thread.messages };
  });
  await editor.fill('Exercise the two fixed read-only tool cycles in this private fixture.');
  await card.getByRole('button', { name: 'Send', exact: true }).click();
  await expect.poll(async () => (await snapshot()).turns, { timeout: 20000 }).toBe(1);
  const state = await snapshot();
  const assistants = state.messages.filter((message: any) => message.sender === 'assistant' && message.blocks?.some((block: any) => block.type === 'thinking'));
  expect(assistants).toHaveLength(1);
  const message = assistants[0];
  const thinking = message.blocks.find((block: any) => block.type === 'thinking').props;
  const activity = message.blocks.find((block: any) => block.type === 'tool-activity').props;
  const summaries = [1, 2, 3].map(index => `Synthetic thinking summary ${index}.`);
  expect(thinking.content).toBe(summaries.join('\n\n'));
  expect(thinking.state).toBe('done');
  expect(thinking.nativeMessages).toHaveLength(3);
  expect(thinking.nativeMessages.map((row: any) => row.text)).toEqual(summaries);
  expect(thinking.nativeMessages.every((row: any) => row.isSummary === true && thinking.content.slice(row.start, row.end) === row.text)).toBe(true);
  expect(new Set(thinking.nativeMessages.map((row: any) => row.uuid)).size).toBe(3);
  expect(JSON.stringify(thinking)).not.toContain('signature');
  expect(activity.entries.map((entry: any) => ({ id: entry.id, tool: entry.tool, status: entry.status }))).toEqual([
    { id: 'thinking_cycle_1', tool: 'Bash', status: 'ok' }, { id: 'thinking_cycle_2', tool: 'Bash', status: 'ok' },
  ]);
  expect(activity.entries.map((entry: any) => entry.outputSummary)).toEqual(['NATIVE_THINKING_CYCLE_1', 'NATIVE_THINKING_CYCLE_2']);
  expect(state.tools).toBe(2);
  expect(message.text).toBe('Thinking cycles completed.');
  const bubble = appPage.locator(`[data-chat-message="${message.id}"]`);
  const toggle = bubble.getByRole('button', { name: /^Thought for/ });
  const rows = bubble.locator('[data-native-summary]');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(rows).toHaveCount(0);
  await toggle.click(); await expect(rows).toHaveCount(3);
  const ids = await rows.evaluateAll(elements => elements.map(element => element.getAttribute('data-native-summary')));
  expect(ids).toEqual(thinking.nativeMessages.map((row: any) => row.uuid));
  const readJson = async (name: string, empty: string) => JSON.parse(await readFile(join(workspace!, name), 'utf8').catch(error => { if (error.code === 'ENOENT') return empty; throw error }));
  for (let index = 0; index < 3; index++) {
    await expect(rows.nth(index)).toContainText('Summary display: ' + summaries[index]);
    await rows.nth(index).getByRole('button', { name: 'Inspect native summary', exact: true }).click();
    await expect.poll(async () => (await readJson('app-summary-presses.json', '[]')).length).toBe(index + 1);
    await rows.nth(index).getByLabel('Summary note', { exact: true }).fill(`Cycle ${index + 1} note`);
    await expect.poll(() => readJson('app-summary-note.json', '{}')).toEqual({ id: ids[index], value: `Cycle ${index + 1} note` });
  }
  for (let index = 0; index < 3; index++) await expect(rows.nth(index).getByLabel('Summary note', { exact: true })).toHaveValue(`Cycle ${index + 1} note`);
  for (let index = 0; index < 3; index++) await expect(rows.nth(index).getByRole('button', { name: 'Inspect native summary', exact: true })).toBeEnabled();
  const oldActions = await appPage.evaluate(() => {
    const context = (window as any).applicationState.system.get('default-setup/threads').getSnapshot().context;
    const [mountId, view]: any = Object.entries(context.nativeUiViews).find(([, view]: any) => view.threadId === context.currentThread.id)!;
    const find = (node: any): string | undefined => node?.kind === 'button' ? node.actionId : node?.children?.map(find).find(Boolean);
    return view.state.transcriptMessages.filter((frame: any) => frame.isSummary).map((frame: any) => ({ mountId, threadId: context.currentThread.id, actionId: find(frame.body.tree) }));
  });
  expect(oldActions.every((value: any) => value.actionId)).toBe(true);
  const toolsToggle = card.getByRole('button', { name: 'Session tools', exact: true });
  if (await toolsToggle.getAttribute('aria-expanded') === 'true') await toolsToggle.click();
  await toggle.locator('..').scrollIntoViewIfNeeded();
  await appPage.screenshot({ path: testInfo.outputPath('apack-thinking-tool-cycles.png') });
  await toggle.click(); await expect(rows).toHaveCount(0);
  for (const identity of oldActions) await appPage.evaluate(identity => (window as any).applicationState.system.get('default-setup/threads').send({ type: 'CLAUDE_UI_PRESS', ...identity }), identity);
  await toggle.click(); await expect(rows).toHaveCount(3);
  for (let index = 0; index < 3; index++) await expect(rows.nth(index).getByLabel('Summary note', { exact: true })).toHaveValue(`Cycle ${index + 1} note`);
  expect(await readJson('app-summary-presses.json', '[]')).toEqual(ids.map((id, index) => ({ id, text: summaries[index] })));
  expect((await snapshot()).turns).toBe(1);
  const launches = (await readFile(join(workspace!, 'native-launches.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  expect(launches.filter(value => value.args.includes('--input-format'))).toHaveLength(1);
  expect(errors).toEqual([]);
  await writeFile(join(workspace!, 'thinking-cycles-app-evidence.json'), JSON.stringify({ actualApp: true, threeThinkingSegments: true, twoToolEntries: true, originalThinkingPreserved: true, distinctNativeRows: true, independentSummaryControls: true, collapseRetiresActions: true, sameNativeProcess: true, hostInputs: 1, summaryIds: ids, toolIds: activity.entries.map((entry: any) => entry.id), errors }, null, 2));
});
