// The pack's backend stopping is not the process ending: a reload replaces the pack's code in a process that
// goes on, and whatever the old code had started is then held by nothing. What it started is ended here.
import { afterEach, expect, it, vi } from 'vitest'
import { onShutdown } from '#features/hooks.ts'
import { getHandle as claudeTurn, storeHandle as storeClaudeTurn } from '#features/code/be/services/claude-code/handle-store.ts'
import { getHandle as codexTurn, storeHandle as storeCodexTurn } from '#features/code/be/services/codex/handle-store.ts'
import { CodexAppServer } from '#features/code/be/services/codex/app-server.ts'
import type { QueryHandle } from '#features/code/be/services/claude-code/query.ts'

afterEach(() => { vi.restoreAllMocks() })

it('ends every Claude turn under way, and no longer holds it', () => {
  const kills = { first: vi.fn(), second: vi.fn() }
  storeClaudeTurn('thread-1', { kill: kills.first } as unknown as QueryHandle)
  storeClaudeTurn('thread-2', { kill: kills.second } as unknown as QueryHandle)

  onShutdown()

  expect([kills.first.mock.calls.length, kills.second.mock.calls.length]).toEqual([1, 1])
  expect([claudeTurn('thread-1'), claudeTurn('thread-2')]).toEqual([undefined, undefined])
})

it('ends the other turns when one of them cannot be ended', () => {
  const kill = vi.fn()
  storeClaudeTurn('thread-1', { kill: () => { throw new Error('already gone') } } as unknown as QueryHandle)
  storeClaudeTurn('thread-2', { kill } as unknown as QueryHandle)

  onShutdown()

  expect(kill).toHaveBeenCalledOnce()
})

it('stops the Codex app server, which every Codex turn runs in, and holds none of its turns', () => {
  const stop = vi.spyOn(CodexAppServer.prototype, 'stop').mockResolvedValue()
  storeCodexTurn('thread-1', { codexThreadId: 'c-1', turnId: 't-1', abort: async () => {} })

  onShutdown()

  expect(stop).toHaveBeenCalledOnce()
  expect(codexTurn('thread-1')).toBeUndefined()
})
