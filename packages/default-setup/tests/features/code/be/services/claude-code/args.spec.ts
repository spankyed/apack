/**
 * Table-driven tests for `argsFromOptions`.
 *
 * Every option in `QueryOptions` should have a case here. When adding a
 * new option to `args.ts`, add the matching row. Tests run as a pure
 * function — no spawning, no disk access.
 */

import { argsFromOptions } from '#features/code/be/services/claude-code/args.ts'
import { EffortSchema } from '#features/code/be/services/claude-code/types.ts'
import type { QueryOptions } from '#features/code/be/services/claude-code/types.ts'

/** Assert that `needles` appear in `haystack` in the given order (contiguous). */
function expectContains(haystack: string[], needles: string[]): void {
  for (let i = 0; i <= haystack.length - needles.length; i++) {
    let match = true
    for (let j = 0; j < needles.length; j++) {
      if (haystack[i + j] !== needles[j]) { match = false; break }
    }
    if (match) return
  }
  throw new Error(`expected [${needles.join(', ')}] to appear contiguously in argv:\n  ${haystack.join(' ')}`)
}

describe('argsFromOptions', () => {
  describe('defaults', () => {
    it('always emits --print + stream-json framing + --verbose', () => {
      const args = argsFromOptions({})
      expect(args).toContain('--print')
      expectContains(args, ['--input-format', 'stream-json'])
      expectContains(args, ['--output-format', 'stream-json'])
      expect(args).toContain('--verbose')
    })

    it('always emits --permission-prompt-tool stdio', () => {
      // Load-bearing: without this flag the CLI's getCanUseToolFn takes the
      // no-prompt-tool branch (internal resolver), never emits `can_use_tool`
      // control_requests, and falls back to prose-based permission denials.
      // See leaked CLI source at src/cli/print.ts:4267-4293 and args.ts
      // for the full leaked-source reference comment.
      const args = argsFromOptions({})
      expectContains(args, ['--permission-prompt-tool', 'stdio'])
    })

    it('emits no optional flags when options are empty', () => {
      const args = argsFromOptions({})
      // Sanity: no common optional flags leak in from defaults.
      expect(args).not.toContain('--model')
      expect(args).not.toContain('--continue')
      expect(args).not.toContain('--resume')
      expect(args).not.toContain('--dangerously-skip-permissions')
      expect(args).not.toContain('--include-partial-messages')
      // No `undefined` string literals from template-mapping accidents.
      expect(args).not.toContain('undefined')
      expect(args).not.toContain('null')
    })
  })

  describe('model / behaviour', () => {
    const cases: Array<[Partial<QueryOptions>, string[]]> = [
      [{ model: 'sonnet' }, ['--model', 'sonnet']],
      [{ fallbackModel: 'haiku' }, ['--fallback-model', 'haiku']],
      [{ effort: 'high' }, ['--effort', 'high']],
      [{ effort: 'xhigh' }, ['--effort', 'xhigh']],
      [{ thinking: 'enabled' }, ['--thinking', 'enabled']],
      [{ maxThinkingTokens: 1024 }, ['--max-thinking-tokens', '1024']],
      [{ maxTurns: 10 }, ['--max-turns', '10']],
      [{ maxBudgetUsd: 0.5 }, ['--max-budget-usd', '0.5']],
      [{ agent: 'Explore' }, ['--agent', 'Explore']],
    ]
    it.each(cases)('%o → argv contains %o', (opts, needles) => {
      expectContains(argsFromOptions(opts), needles)
    })

    it('serialises --agents as JSON', () => {
      const agents = { Explore: { description: 'd', prompt: 'p' } }
      const args = argsFromOptions({ agents })
      expectContains(args, ['--agents', JSON.stringify(agents)])
    })

    it('spreads --betas as multiple values', () => {
      const args = argsFromOptions({ betas: ['a', 'b', 'c'] })
      expectContains(args, ['--betas', 'a', 'b', 'c'])
    })
  })

  describe('permissions', () => {
    it('maps permissionMode', () => {
      const args = argsFromOptions({ permissionMode: 'default' })
      expectContains(args, ['--permission-mode', 'default'])
    })

    it.each([
      'default', 'acceptEdits', 'plan', 'bypassPermissions', 'dontAsk', 'auto',
    ] as const)('%s is accepted and emitted verbatim', (mode) => {
      expectContains(argsFromOptions({ permissionMode: mode }), ['--permission-mode', mode])
    })

    it('emits --dangerously-skip-permissions only when flagged', () => {
      expect(argsFromOptions({}).includes('--dangerously-skip-permissions')).toBe(false)
      expect(argsFromOptions({ dangerouslySkipPermissions: true }).includes('--dangerously-skip-permissions')).toBe(true)
    })

    it('makes bypass available only when requested, without selecting it as the starting mode', () => {
      const args = argsFromOptions({ allowDangerouslySkipPermissions: true, permissionMode: 'default' })
      expect(args).toContain('--allow-dangerously-skip-permissions')
      expectContains(args, ['--permission-mode', 'default'])
      expect(args).not.toContain('--dangerously-skip-permissions')
      expect(argsFromOptions({})).not.toContain('--allow-dangerously-skip-permissions')
      expect(argsFromOptions({ allowDangerouslySkipPermissions: false })).not.toContain('--allow-dangerously-skip-permissions')
    })

    it('spreads allowedTools / disallowedTools', () => {
      const args = argsFromOptions({
        allowedTools: ['Read', 'Glob'],
        disallowedTools: ['Bash'],
      })
      expectContains(args, ['--allowed-tools', 'Read', 'Glob'])
      expectContains(args, ['--disallowed-tools', 'Bash'])
    })

    it("handles tools: 'default' as literal string", () => {
      const args = argsFromOptions({ tools: 'default' })
      expectContains(args, ['--tools', 'default'])
    })

    it('handles tools: [] as empty string', () => {
      const args = argsFromOptions({ tools: [] })
      expectContains(args, ['--tools', ''])
    })

    it('handles tools: [name,name] as spread', () => {
      const args = argsFromOptions({ tools: ['Read', 'Bash'] })
      expectContains(args, ['--tools', 'Read', 'Bash'])
    })

    it('omits --allowed-tools when the array is empty', () => {
      expect(argsFromOptions({ allowedTools: [] })).not.toContain('--allowed-tools')
    })
  })

  describe('system prompt', () => {
    it('maps each system prompt variant', () => {
      const args = argsFromOptions({
        systemPrompt: 'sp',
        appendSystemPrompt: 'asp',
        systemPromptFile: '/tmp/sp',
        appendSystemPromptFile: '/tmp/asp',
      })
      expectContains(args, ['--system-prompt', 'sp'])
      expectContains(args, ['--append-system-prompt', 'asp'])
      expectContains(args, ['--system-prompt-file', '/tmp/sp'])
      expectContains(args, ['--append-system-prompt-file', '/tmp/asp'])
    })
  })

  describe('mcp / plugins / dirs', () => {
    it('spreads --mcp-config', () => {
      const args = argsFromOptions({ mcpConfig: ['a.json', 'b.json'] })
      expectContains(args, ['--mcp-config', 'a.json', 'b.json'])
    })

    it('adds --strict-mcp-config only when set', () => {
      expect(argsFromOptions({}).includes('--strict-mcp-config')).toBe(false)
      expect(argsFromOptions({ strictMcpConfig: true }).includes('--strict-mcp-config')).toBe(true)
    })

    it('repeats --plugin-dir once per entry', () => {
      const args = argsFromOptions({ pluginDir: ['/a', '/b'] })
      const count = args.filter(a => a === '--plugin-dir').length
      expect(count).toBe(2)
      expectContains(args, ['--plugin-dir', '/a'])
      expectContains(args, ['--plugin-dir', '/b'])
    })

    it('spreads --add-dir as a single flag with multiple values', () => {
      const args = argsFromOptions({ addDir: ['/x', '/y'] })
      expectContains(args, ['--add-dir', '/x', '/y'])
    })
  })

  describe('settings', () => {
    it('maps --settings', () => {
      const args = argsFromOptions({ settings: '/tmp/s.json' })
      expectContains(args, ['--settings', '/tmp/s.json'])
    })

    it('joins settingSources with commas', () => {
      const args = argsFromOptions({ settingSources: ['user', 'project'] })
      expectContains(args, ['--setting-sources', 'user,project'])
    })
  })

  it('preserves an explicit empty setting-source selection rather than inheriting defaults', () => {
    expectContains(argsFromOptions({ settingSources: [] }), ['--setting-sources', ''])
    expect(argsFromOptions({})).not.toContain('--setting-sources')
  })

  it('accepts xhigh through the public effort schema', () => {
    expect(EffortSchema.parse('xhigh')).toBe('xhigh')
  })

  describe('structured output', () => {
    it('JSON-stringifies jsonSchema', () => {
      const schema = { type: 'object', properties: { x: { type: 'number' } } }
      const args = argsFromOptions({ jsonSchema: schema })
      expectContains(args, ['--json-schema', JSON.stringify(schema)])
    })

    it('passes through primitive jsonSchema values', () => {
      const args = argsFromOptions({ jsonSchema: 'string-value' })
      expectContains(args, ['--json-schema', JSON.stringify('string-value')])
    })
  })

  describe('session control', () => {
    it('adds --continue when continue: true', () => {
      expect(argsFromOptions({ continue: true }).includes('--continue')).toBe(true)
      expect(argsFromOptions({}).includes('--continue')).toBe(false)
    })

    it('resume: true → --resume with no value', () => {
      const args = argsFromOptions({ resume: true })
      expect(args.indexOf('--resume')).toBeGreaterThanOrEqual(0)
      const next = args[args.indexOf('--resume') + 1]
      // Next token should be something unrelated (or absent), not a session id.
      expect(next === undefined || next.startsWith('--')).toBe(true)
    })

    it("resume: 'abc' → --resume abc", () => {
      const args = argsFromOptions({ resume: 'abc' })
      expectContains(args, ['--resume', 'abc'])
    })

    it('--fork-session + --session-id + --no-session-persistence', () => {
      const args = argsFromOptions({
        forkSession: true,
        sessionId: 'uuid-1',
        noSessionPersistence: true,
      })
      expect(args).toContain('--fork-session')
      expectContains(args, ['--session-id', 'uuid-1'])
      expect(args).toContain('--no-session-persistence')
    })
  })

  describe('streaming knobs', () => {
    it.each([
      ['includePartialMessages', '--include-partial-messages'],
      ['includeHookEvents', '--include-hook-events'],
      ['replayUserMessages', '--replay-user-messages'],
    ] as const)('%s → %s', (key, flag) => {
      expect(argsFromOptions({ [key]: true } as Partial<QueryOptions>)).toContain(flag)
      expect(argsFromOptions({ [key]: false } as Partial<QueryOptions>)).not.toContain(flag)
    })
  })
})

it('passes explicit approved-channel selection as native argv without development-channel bypass', () => {
  const args = argsFromOptions({channels:['plugin:review@owned','plugin:notes@owned']})
  expectContains(args,['--channels','plugin:review@owned','plugin:notes@owned'])
  expect(args).not.toContain('--dangerously-load-development-channels')
  expect(argsFromOptions({channels:[]})).not.toContain('--channels')
})
