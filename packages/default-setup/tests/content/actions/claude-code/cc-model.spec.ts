import { describe, expect, it, vi } from 'vitest';
import { mockService } from '@apackdev/testing/harness';
import { services, type Services } from '#generated/services.ts';
import { repository } from '#generated/repository.ts';
import { action } from '../../../../src/content/actions/claude-code/cc-command.ts';

function setup(owner?: object) {
  const { id } = repository.threadCommands.create({ topic: 'Model', instructions: '', tags: [] });
  repository.threadCommands.update(id, { context: { claudeCode: { cwd: '/selected', model: 'observed-sonnet', modelOverride: 'sonnet' } } });
  const settings = vi.fn();
  mockService<Services, 'cli'>('cli', { claudeCode: { getNativeTerminal: vi.fn(), getConversation: vi.fn(() => owner ? { owner } : undefined), getWorkingDir: vi.fn(() => '/selected'), writeSettings: settings } as never });
  mockService<Services, 'chat'>('chat', { sendBlockMessage: vi.fn() });
  return { id, settings, state: () => repository.threadQueries.byId(id)?.context?.claudeCode };
}
const run = (id: string, text?: string) => action({ command: 'cc-model', threadId: id, text }, services, {} as never, 'model-flow');
describe('thread model selection', () => {
  it('stages a selection without a fresh process or global settings edit', async () => {
    const f = setup();
    expect((await run(f.id, 'haiku')).text).toContain('next launch');
    expect(f.state()).toMatchObject({ modelOverride: 'haiku', model: 'observed-sonnet' });
    expect(f.settings).not.toHaveBeenCalled();
    expect((await run(f.id)).text).toContain('Selected: haiku');
  });
  it('persists only after native acknowledgement and preserves observed model', async () => {
    let acknowledge!: () => void;
    const setModel = vi.fn(() => new Promise<void>(resolve => { acknowledge = resolve }));
    const f = setup({ busy: false, sessionCwd: '/selected', handle: { setModel } });
    const change = run(f.id, 'research-custom-model');
    await vi.waitFor(() => expect(setModel).toHaveBeenCalledWith('research-custom-model'));
    expect(f.state()).toMatchObject({ modelOverride: 'sonnet' });
    acknowledge();
    expect((await change).text).toContain('selection accepted');
    expect(f.state()).toMatchObject({ modelOverride: 'research-custom-model', model: 'observed-sonnet' });
    expect(f.settings).not.toHaveBeenCalled();
  });
  it.each(['busy', 'cwd', 'refusal'])('leaves selection unchanged on %s', async kind => {
    const setModel = vi.fn().mockRejectedValue(new Error('native refusal'));
    const f = setup({ busy: kind === 'busy', sessionCwd: kind === 'cwd' ? '/other' : '/selected', handle: { setModel } });
    const result = await run(f.id, 'haiku');
    expect(result.text).toContain(kind === 'busy' ? 'idle' : kind === 'cwd' ? 'does not match' : 'native refusal');
    expect(f.state()).toMatchObject({ modelOverride: 'sonnet' });
    expect(setModel).toHaveBeenCalledTimes(kind === 'refusal' ? 1 : 0);
  });
});

it.each([true, false])('replays input queued during a model acknowledgement (accepted=%s)', async accepted => {
  let settle!: () => void;
  let busy = false;
  const setModel = vi.fn(async () => {
    busy = true;
    try { await new Promise<void>((resolve, reject) => { settle = () => accepted ? resolve() : reject(new Error('model refused')); }); }
    finally { busy = false; }
  });
  const owner = { get busy() { return busy; }, closing: false, sessionCwd: '/selected', handle: { setModel } };
  const f = setup(owner);
  const replay = vi.fn(async () => { expect(f.state()).toMatchObject({ modelOverride: accepted ? 'haiku' : 'sonnet', queuedMessage: undefined }); });
  mockService<Services, 'action'>('action', { executeIfFound: replay });
  mockService<Services, 'logger'>('logger', { debug: vi.fn(), error: vi.fn() });
  const command = run(f.id, 'haiku');
  await vi.waitFor(() => expect(busy).toBe(true));
  const thread = repository.threadQueries.byId(f.id)!;
  repository.threadCommands.update(f.id, { context: { ...thread.context, claudeCode: { ...f.state(), queuedMessage: { text: 'queued during validation', mode: 'Claude Code' } } } });
  settle();
  await command;
  expect(replay).toHaveBeenCalledWith('Claude Code Chat', expect.objectContaining({ threadId: f.id, text: 'queued during validation' }));
});

it('uses the native terminal owner and saves its canonical acknowledgement', async () => {
  const f = setup();
  let acknowledge!: (value: string) => void;
  const native = { state: { cwd: '/selected', sessionId: 'session' }, busy: false, setModel: vi.fn(() => new Promise<string>(resolve => { acknowledge = resolve; })) };
  vi.mocked(services.cli.claudeCode.getNativeTerminal).mockReturnValue(native as never);
  const changing = run(f.id, 'HAIKU');
  await vi.waitFor(() => expect(native.setModel).toHaveBeenCalledWith('HAIKU'));
  expect(f.state()?.modelOverride).toBe('sonnet');
  acknowledge('haiku');
  expect((await changing).text).toContain('selection accepted: haiku');
  expect(f.state()).toMatchObject({ modelOverride: 'haiku', model: 'observed-sonnet' });
  expect(f.settings).not.toHaveBeenCalled();
});
it.each(['busy', 'refusal', 'replacement'])('retains selection when native model control encounters %s', async kind => {
  const f = setup();
  const native = { state: { cwd: '/selected', sessionId: 'session' }, busy: kind === 'busy', setModel: vi.fn(async () => {
    if (kind === 'refusal') throw new Error('Native model policy refused');
    vi.mocked(services.cli.claudeCode.getNativeTerminal).mockReturnValue(undefined);
    return 'haiku';
  }) };
  vi.mocked(services.cli.claudeCode.getNativeTerminal).mockReturnValue(native as never);
  await run(f.id, 'haiku');
  expect(f.state()?.modelOverride).toBe('sonnet');
  expect(native.setModel).toHaveBeenCalledTimes(kind === 'busy' ? 0 : 1);
});
