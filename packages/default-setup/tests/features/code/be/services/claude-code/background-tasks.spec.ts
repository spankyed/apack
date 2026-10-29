import { describe, expect, it } from 'vitest'
import { createBackgroundTaskTracker } from '../../../../../../src/features/code/be/services/claude-code/background-tasks.ts'
import type { StreamLine } from '../../../../../../src/features/code/be/services/claude-code/types.ts'
const event = (value: Record<string, unknown>) => value as StreamLine

describe('native background task result snapshots', () => {
  it('preserves earlier pending state even after later completion and another result are buffered', () => {
    const tracker = createBackgroundTaskTracker()
    const first = event({ type: 'result', subtype: 'success' })
    const second = event({ type: 'result', subtype: 'success' })
    tracker.observe(event({ type: 'system', subtype: 'task_started', task_id: 'fixture' }))
    tracker.observe(first)
    tracker.observe(event({ type: 'system', subtype: 'task_notification', task_id: 'fixture', status: 'completed' }))
    tracker.observe(second)
    expect(tracker.hasPendingTasks(first)).toBe(true)
    expect(tracker.hasPendingTasks(second)).toBe(false)
  })
  it('keeps unrelated tasks pending and handles failed/stopped completion idempotently', () => {
    const tracker = createBackgroundTaskTracker()
    for (const id of ['one', 'two']) tracker.observe(event({ type: 'system', subtype: 'task_started', task_id: id }))
    tracker.observe(event({ type: 'system', subtype: 'task_notification', task_id: 'one', status: 'failed' }))
    const first = event({ type: 'result' }); tracker.observe(first)
    expect(tracker.hasPendingTasks(first)).toBe(true)
    for (let i = 0; i < 2; i++) tracker.observe(event({ type: 'system', subtype: 'task_notification', task_id: 'two', status: 'stopped' }))
    const last = event({ type: 'result' }); tracker.observe(last)
    expect(tracker.hasPendingTasks(last)).toBe(false)
    expect(() => tracker.hasPendingTasks(event({ type: 'result' }))).toThrow('Expected a result')
  })
})
