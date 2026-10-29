import { describe, expect, it } from 'vitest'
import { createStderrTail } from '../../../../../../src/features/code/be/services/claude-code/stderr-tail.ts'

describe('bounded stderr', () => {
  it('retains the exact boundary and copies oversized backing buffers', () => {
    const tail = createStderrTail(8)
    const source = Buffer.from('0123456789')
    tail.append(source)
    source.fill(120)
    expect(tail.retainedBytes).toBe(8)
    expect(tail.discardedBytes).toBe(2)
    expect(tail.text()).toBe('[stderr truncated: 2 bytes discarded]\n23456789')
  })
  it('bounds sustained output and retains late diagnostics', () => {
    const tail = createStderrTail(16)
    for (let i = 0; i < 10000; i++) tail.append(Buffer.from('0123456789'))
    tail.append(Buffer.from('fatal'))
    expect(tail.retainedBytes).toBe(16)
    expect(tail.discardedBytes).toBe(99989)
    expect(tail.text()).toMatch(/fatal$/)
  })
  it('joins split UTF-8 and removes a cut leading sequence', () => {
    const tail = createStderrTail(5)
    const bytes = Buffer.from('€abc')
    tail.append(bytes.subarray(0, 2))
    tail.append(bytes.subarray(2))
    expect(tail.text()).toBe('[stderr truncated: 1 bytes discarded]\nabc')
    const whole = createStderrTail()
    whole.append(bytes.subarray(0, 2)); whole.append(bytes.subarray(2))
    expect(whole.text()).toBe('€abc')
  })
})
