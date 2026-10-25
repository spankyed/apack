import { createApp, nextTick, reactive } from 'vue'
import NativeSettingsStats from '#features/threads/fe/chat/NativeSettingsStats.vue'
import type { ClaudeSettingsStats } from '#features/code/common/native-settings.ts'

it('counts cache tokens, preserves native summaries and waits for native export feedback', async () => {
  const stats = reactive<ClaudeSettingsStats>({outcome:'success',loading:false,copyState:'idle',view:'Overview',range:'all',calendar:['    Sep Oct','    ·░▒▓█····█','Mon ········· ','    ········· ','Wed ········· ','    ········· ','Fri ········· ','    ········· ','','    Less ░ ▒ ▓ █ More'].join('\n'),insight:'Original native insight',data:{totalSessions:1,totalMessages:4,totalDays:2,activeDays:1,streaks:{currentStreak:1,longestStreak:1},longestSession:{sessionId:'original-session',duration:65000,messageCount:4,timestamp:'2026-10-25T12:00:00Z'},dailyActivity:[{date:'2026-10-25',messageCount:4,sessionCount:1,toolCallCount:2}],allTimeActivity:[{date:'2026-10-25',messageCount:4,sessionCount:1,toolCallCount:2}],dailyModelTokens:[{date:'2026-10-25',tokensByModel:{model:20}}],modelUsage:{model:{inputTokens:10,outputTokens:5,cacheReadInputTokens:3,cacheCreationInputTokens:2,costUSD:0.02}}}})
  const action=vi.fn(),root=document.createElement('div');document.body.append(root)
  const app=createApp(NativeSettingsStats,{stats,pending:false,onAction:action});app.mount(root)
  try {
    await nextTick()
    expect(root.textContent).toContain('Original native insight')
    const calendar=root.querySelector('[aria-label="Claude Code activity calendar"]')!
    expect(calendar.tagName).toBe('FIGURE')
    expect(calendar.querySelectorAll('[data-activity-level]')).toHaveLength(70)
    expect(calendar.querySelectorAll('[data-activity-level="future"]')).toHaveLength(6)
    expect(calendar.querySelectorAll('[data-activity-level="4"]')).toHaveLength(2)
    expect(calendar.querySelector('pre')).toBeNull()
    expect(calendar.textContent).not.toMatch(/[·░▒▓█]/)
    expect(root.textContent).toContain('Longest session')
    expect(root.textContent).toContain('1m 5s')
    expect(root.textContent).not.toContain('Peak hour')
    const total=[...root.querySelectorAll('dt')].find(node=>node.textContent==='Total tokens')!
    expect(total.nextElementSibling?.textContent).toBe('20')
    const copy=[...root.querySelectorAll('button')].find(button=>button.textContent==='Copy stats')!
    copy.click();expect(action).toHaveBeenCalledWith('copy')
    expect(root.textContent).not.toContain('Copied by Claude Code')
    stats.copyState='pending';await nextTick();expect(copy.disabled).toBe(true);expect(root.textContent).toContain('Copying stats')
    stats.copyState='error';await nextTick();expect(root.querySelector('[role="alert"]')?.textContent).toContain('could not copy')
    stats.copyState='saved';stats.view='Models';await nextTick()
    expect(root.textContent).toContain('Copied by Claude Code');expect(root.textContent).toContain('Tokens per recorded day')
    expect(root.querySelector('tbody')?.textContent).toContain('model')
  } finally {app.unmount();root.remove()}
})
