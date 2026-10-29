import {
  parseExitPlanModeInput,
  buildPlanApprovalContext,
  type ParsedPlanInput,
} from '../../../../../src/content/actions/claude-code/_helpers/plan-approval.ts'

describe('parseExitPlanModeInput', () => {
  it('native normalized input preserves plan and path while ignoring unused prompts', () => {
    const input = {
      plan: '# Plan\n\n1. Do the thing\n2. Then the other thing',
      planFilePath: '/tmp/claude-plan-123.md',
      allowedPrompts: [{ tool: 'Bash', prompt: 'run tests' }],
    }
    expect(parseExitPlanModeInput(input)).toEqual({
      plan: '# Plan\n\n1. Do the thing\n2. Then the other thing',
      planFilePath: '/tmp/claude-plan-123.md',
    })
  })

  it('missing plan → empty string and no path', () => {
    const parsed = parseExitPlanModeInput({})
    expect(parsed.plan).toBe('')
    expect(parsed.planFilePath).toBeUndefined()
  })

  it('non-string plan field is ignored, never thrown', () => {
    expect(parseExitPlanModeInput({ plan: 42 }).plan).toBe('')
    expect(parseExitPlanModeInput({ plan: null }).plan).toBe('')
    expect(parseExitPlanModeInput({ plan: { nested: 'x' } }).plan).toBe('')
  })

  it('ignores both valid and malformed entries in the unused prompts field', () => {
    const parsed = parseExitPlanModeInput({ plan: 'x', allowedPrompts: [
      { tool: 'Bash', prompt: 'run tests' }, { tool: 'NotBash' }, null, 'invalid',
    ] })
    expect(buildPlanApprovalContext(parsed)).toBe('x')
    expect(parsed).not.toHaveProperty('allowedPrompts')
  })

  it('ignores non-array values of the unused prompts field', () => {
    for (const allowedPrompts of ['str', null, {}]) {
      expect(buildPlanApprovalContext(parseExitPlanModeInput({ plan: 'x', allowedPrompts }))).toBe('x')
    }
  })

  it.each([null, undefined, 'string', 42, [], true] as const)(
    'non-object input %p → empty parsed shape',
    (input) => {
      expect(parseExitPlanModeInput(input)).toEqual({ plan: '' })
    },
  )
})

describe('buildPlanApprovalContext', () => {
  const baseParsed = (overrides: Partial<ParsedPlanInput> = {}): ParsedPlanInput => ({
    plan: '',
    ...overrides,
  })

  it('short plan → full body', () => {
    const ctx = buildPlanApprovalContext(baseParsed({
      plan: '# Do the thing\n\n1. Step one',
    }))
    expect(ctx).toBe('# Do the thing\n\n1. Step one')
  })

  it('long plan → full body passed through (UI handles scrolling)', () => {
    const long = 'A'.repeat(500)
    const ctx = buildPlanApprovalContext(baseParsed({ plan: long }))
    expect(ctx).toBe(long)
  })

  it('trims whitespace before measuring length', () => {
    const ctx = buildPlanApprovalContext(baseParsed({ plan: '\n\n  hi  \n\n' }))
    expect(ctx).toBe('hi')
  })

  it('empty plan → placeholder', () => {
    expect(buildPlanApprovalContext(baseParsed({ plan: '' }))).toBe('(no plan content provided)')
  })

  it('whitespace-only plan → placeholder', () => {
    expect(buildPlanApprovalContext(baseParsed({ plan: '   \n\n  \t' })))
      .toBe('(no plan content provided)')
  })

  it('does not render unused prompts as requested permissions', () => {
    const parsed = parseExitPlanModeInput({ plan: 'Short plan', allowedPrompts: [
      { tool: 'Bash', prompt: 'run tests' }, { tool: 'Bash', prompt: 'install deps' },
    ] })
    expect(buildPlanApprovalContext(parsed)).toBe('Short plan')
  })

  it('unused prompts do not replace an absent plan with a permissions footer', () => {
    expect(buildPlanApprovalContext(parseExitPlanModeInput({
      allowedPrompts: [{ tool: 'Bash', prompt: 'run tests' }],
    }))).toBe('(no plan content provided)')
  })
})
