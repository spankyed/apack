import { expect,it,vi } from 'vitest'
import { registerThreadHistoryValidator,runThreadHistoryOperation } from '#features/threads/be/history-operation.ts'
it('does not commit after cancellation, even if validation ignores its signal',async()=>{
  let release!:()=>void
  const off=registerThreadHistoryValidator(()=>new Promise<void>(resolve=>{release=resolve}))
  const controller=new AbortController(),commit=vi.fn(),rejected=vi.fn()
  try {
    const pending=runThreadHistoryOperation({request:{kind:'fork',threadId:'fixture',messageId:'fixture'},snapshot:'same',readSnapshot:()=> 'same',commit,rejected},controller.signal)
    await vi.waitFor(()=>expect(release).toBeTypeOf('function'))
    controller.abort();release();await pending
    expect(commit).not.toHaveBeenCalled();expect(rejected).not.toHaveBeenCalled()
  } finally {off()}
})
