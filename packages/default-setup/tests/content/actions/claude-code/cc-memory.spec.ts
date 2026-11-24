import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { cpuBudget } from '@apackdev/testing/vitest'
import { query } from '#features/code/be/services/claude-code/query.ts'
import { setClaudeAutoMemory } from '#features/code/be/services/claude-code/memory.ts'
import * as cliResolver from '#features/code/be/utils/resolve-cli.ts'
import { mockService } from '@apackdev/testing/harness'
import { expect, it, vi } from 'vitest'
import { services, type Services } from '#generated/services.ts'
import { action } from '../../../../src/content/actions/claude-code/cc-command.ts'

const memory = {
  files: [{ kind: 'project', path: '/picked/CLAUDE.md', label: 'Project instructions', exists: true }],
  folders: [],
  auto_memory: { enabled: true, toggleable: true, status: 'on' },
  auto_dream: { shown: false, status: 'off', detail: '' },
}
const run = (text?: string) => action({ command: 'cc-memory', threadId: 'memory-thread', text }, services)

function setup(live = false) {
  let state = { cwd: '/saved', cwdOverride: '/picked', profile: { configDir: '/thread-profile' } }
  const handle = { getMemoryDialog: vi.fn().mockResolvedValue(memory), close: vi.fn().mockResolvedValue(undefined) }
  const owner = { sessionId: 'session', sessionCwd: '/picked', handle }
  const query = vi.fn().mockResolvedValue(handle)
  const setAutoMemory = vi.fn().mockResolvedValue(undefined)
  const isConversationBusy = vi.fn().mockReturnValue(false)
  const getNativeTerminal = vi.fn()
  const sendBlockMessage = vi.fn()
  mockService<Services, 'cli'>('cli', { claudeCode: {
    query, setAutoMemory, getNativeTerminal, isConversationBusy,
    getWorkingDir: () => '/configured', profile: () => ({ configDir: '/default-profile' }),
    getConversation: () => live ? { owner } : undefined,
  } as never })
  mockService<Services, 'repository'>('repository', { threadQueries: {
    byId: () => ({ context: { claudeCode: state } }),
  } } as never)
  mockService<Services, 'chat'>('chat', { sendBlockMessage })
  return { handle, owner, query, setAutoMemory, getNativeTerminal, sendBlockMessage,
    selectDirectory: (path: string) => { state = { ...state, cwdOverride: path } } }
}

it('reads the selected native project/profile and closes temporary discovery', async () => {
  const f = setup()
  const result = await run()
  expect(result.text).toContain('Project instructions [project]  /picked/CLAUDE.md')
  expect(result.text).toContain('Auto-memory: on')
  expect(result.text).not.toContain('Auto-dream')
  expect(f.query).toHaveBeenCalledWith({ cwd: '/picked', env: {
    CLAUDE_CONFIG_DIR: '/thread-profile', CLAUDE_SECURESTORAGE_CONFIG_DIR: undefined,
  }, keepStdinOpen: true, noSessionPersistence: true, strictMcpConfig: true })
  expect(f.handle.close).toHaveBeenCalledOnce()
  expect(f.setAutoMemory).not.toHaveBeenCalled()
  expect(f.sendBlockMessage).toHaveBeenCalledWith(expect.objectContaining({ threadId: 'memory-thread', text: result.text }))
})

it('uses one retained process for readback and keeps effective state distinct from the stored preference', async () => {
  const f = setup(true)
  const result = await run('auto off')
  expect(f.setAutoMemory).toHaveBeenCalledWith(false, { cwd: '/picked', env: {
    CLAUDE_CONFIG_DIR: '/thread-profile', CLAUDE_SECURESTORAGE_CONFIG_DIR: undefined,
  } })
  expect(result.text).toContain('Saved user Auto-memory preference: off.')
  expect(result.text).toContain('Auto-memory: on')
  expect(f.handle.getMemoryDialog).toHaveBeenCalledTimes(2)
  expect(f.handle.close).not.toHaveBeenCalled()
  expect(f.query).not.toHaveBeenCalled()
})

it('does not write a locked native preference or a stale thread selection', async () => {
  const f = setup(true)
  f.handle.getMemoryDialog.mockResolvedValueOnce({ ...memory, auto_memory: {
    enabled: true, toggleable: false, status: 'on, set by policy',
  } })
  expect((await run('auto off')).text).toContain('set by policy')
  f.handle.getMemoryDialog.mockImplementationOnce(async () => {
    f.selectDirectory('/replacement')
    return memory
  })
  expect((await run('auto off')).text).toContain('changed while reading memory')
  expect(f.setAutoMemory).not.toHaveBeenCalled()
})

it('keeps read, edit and readback on the current terminal owner', async () => {
  const f = setup()
  const getMemoryDialog = vi.fn().mockResolvedValueOnce(memory).mockResolvedValueOnce({
    ...memory, auto_memory: { enabled: false, toggleable: true, status: 'off' },
  })
  const setAutoMemory = vi.fn()
  f.getNativeTerminal.mockReturnValue({
    state: { sessionId: 'terminal-session', cwd: '/picked' }, getMemoryDialog, setAutoMemory,
  })
  const result = await run('auto off')
  expect(result.text).toContain('Auto-memory: off')
  expect(getMemoryDialog).toHaveBeenCalledTimes(2)
  expect(setAutoMemory).toHaveBeenCalledWith(false)
  expect(f.query).not.toHaveBeenCalled()
  expect(f.setAutoMemory).not.toHaveBeenCalled()
})

it('does not edit a replacement terminal session after the native read', async () => {
  const f = setup()
  const state = { sessionId: 'terminal-session', cwd: '/picked' }
  const getMemoryDialog = vi.fn(async () => {
    state.sessionId = 'replacement'
    return memory
  })
  const setAutoMemory = vi.fn()
  f.getNativeTerminal.mockReturnValue({ state, getMemoryDialog, setAutoMemory })
  expect((await run('auto off')).text).toContain('changed while reading memory')
  expect(setAutoMemory).not.toHaveBeenCalled()
  expect(f.query).not.toHaveBeenCalled()
})

const nativeBinary = process.env.CLAUDE_MEMORY_TEST_BINARY
it.skipIf(!nativeBinary)('reads and updates original memory through the command action', { meta: cpuBudget(15_000) }, async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'claude-memory-action-')))
  const project = join(root, 'project')
  const home = join(root, 'home')
  const config = join(home, '.claude')
  const settings = join(config, 'settings.json')
  const sendBlockMessage = vi.fn()
  let requests = 0
  const server = createServer((_request, response) => {
    requests++
    response.writeHead(503).end()
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const resolver = vi.spyOn(cliResolver, 'resolveForService').mockResolvedValue(nativeBinary!)
  try {
    await mkdir(project)
    await mkdir(config, { recursive: true })
    await writeFile(join(project, 'CLAUDE.md'), 'Project instruction fixture.\n')
    await writeFile(join(config, 'CLAUDE.md'), 'User instruction fixture.\n')
    await writeFile(settings, JSON.stringify({ language: 'research-preserve' }))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Missing isolated provider address')
    const env = {
      PATH: process.env.PATH, HOME: home, CLAUDE_CONFIG_DIR: config, CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
      DISABLE_AUTOUPDATER: '1', ANTHROPIC_BASE_URL: `http://127.0.0.1:${address.port}`,
    }
    mockService<Services, 'repository'>('repository', { threadQueries: { byId: () => ({ context: {
      claudeCode: { cwd: project, profile: { configDir: config } },
    } }) } } as never)
    mockService<Services, 'chat'>('chat', { sendBlockMessage })
    mockService<Services, 'cli'>('cli', { claudeCode: {
      getNativeTerminal: () => undefined, getConversation: () => undefined, isConversationBusy: () => false,
      query: (options: Parameters<typeof query>[0]) => query({ ...options, env: { ...env, ...options.env } }),
      setAutoMemory: (enabled: boolean, options: Parameters<typeof setClaudeAutoMemory>[1]) =>
        setClaudeAutoMemory(enabled, { ...options, env: { ...env, ...options.env } }),
    } as never })
    const listed = await run()
    expect(listed.text).toContain(join(config, 'CLAUDE.md'))
    expect(listed.text).toContain(join(project, 'CLAUDE.md'))
    expect(listed.text).toContain('Auto-memory: on')
    expect(listed.text).not.toContain('Auto-dream')
    expect((await run('auto off')).text).toContain('Auto-memory: off')
    expect(JSON.parse(await readFile(settings, 'utf8'))).toMatchObject({
      autoMemoryEnabled: false, language: 'research-preserve',
    })
    expect((await run('auto on')).text).toContain('Auto-memory: on')
    expect(JSON.parse(await readFile(settings, 'utf8'))).toMatchObject({
      autoMemoryEnabled: true, language: 'research-preserve',
    })
    expect(sendBlockMessage).toHaveBeenCalledTimes(3)
    expect(requests).toBe(0)
  } finally {
    resolver.mockRestore()
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    await rm(root, { recursive: true, force: true })
  }
})
