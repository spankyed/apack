import type { AppDriver } from '@apackdev/testing'
import { expect, type Page, type TestInfo } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export async function verifyArtifactWheel({app,appPage,testInfo}:{app:AppDriver;appPage:Page;testInfo:Pick<TestInfo,'outputPath'>}) {
  const directory = await mkdtemp(join(tmpdir(), 'apack-artifact-wheel-'))
  const threadId = `Thread-artifact-wheel-${randomUUID()}`
  let imported = false
  const send = async (event: Record<string, unknown>) => appPage.evaluate(event => {
    (window as any).__sendToSystem('default-setup/threads', event)
  }, event)
  try {
    await app.waitForSurface('default-setup/threads')
    await app.navigate('default-setup/threads')
    const artifacts = Array.from({ length: 30 }, (_, index) => ({
      id: `review-note-${index + 1}`, type: 'text', title: `Review note ${String(index + 1).padStart(2, '0')}`,
      content: `Review finding ${index + 1}: retain the original session and explain the change.`,
      metadata: { createdAt: index + 1 },
    }))
    await writeFile(join(directory, 'exported-threads.json'), JSON.stringify({ version: 2, threads: [{
      id: threadId, topic: 'Release review notes', instructions: '', status: 'Backlog', tags: [],
      shortCode: '', timestamp: Date.now(), linkedThreads: [], artifacts, messages: [],
    }] }))
    await send({ type: 'IMPORT_THREADS', directory }); imported = true
    await expect.poll(() => appPage.evaluate(threadId => (window as any).applicationState.system.get('default-setup/threads').getSnapshot().context.threadMap[threadId]?.topic, threadId)).toBe('Release review notes')
    await appPage.evaluate(threadId => {
      (window as any).applicationState.system.get('default-setup/threads').send({ type: 'OPEN_THREAD_CHAT', threadId })
    }, threadId)
    const viewer = appPage.locator('[data-onboarding-id="canvas-area"] [data-onboarding-id="agent-artifacts"]')
    await expect(viewer).toBeVisible()
    await expect.poll(() => appPage.evaluate(() => (window as any).applicationState.system.get('default-setup/threads').getSnapshot().context.activeTabId)).toBe(threadId)
    await expect(viewer.locator('[title^="Review note "]')).toHaveCount(30)
    const sidebar = viewer.locator(':scope > div').first()
    const last = sidebar.locator('[title="Review note 01"]')
    const readings = []
    for (const viewport of [{ width: 1100, height: 900 }, { width: 680, height: 600 }]) {
      await appPage.setViewportSize(viewport)
      await sidebar.evaluate(element => { element.scrollTop = 0 })
      const before = await sidebar.evaluate(element => ({ top: element.scrollTop, height: element.clientHeight, content: element.scrollHeight }))
      expect(before.content).toBeGreaterThan(before.height)
      await sidebar.hover(); await appPage.mouse.wheel(0, 10000)
      await expect.poll(() => sidebar.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
      await expect(last).toBeInViewport({ ratio: 1 })
      await last.click()
      await expect(viewer).toContainText('Review finding 1: retain the original session and explain the change.')
      const after = await sidebar.evaluate(element => ({ top: element.scrollTop, height: element.clientHeight, content: element.scrollHeight }))
      readings.push({ viewport, before, after })
      await appPage.screenshot({ path: testInfo.outputPath(`artifact-sidebar-wheel-${viewport.width}.png`) })
    }
    await writeFile(testInfo.outputPath('artifact-sidebar-wheel.json'), JSON.stringify({ threadId, readings, modelTurns: 0 }, null, 2))
  } finally {
    if (imported) await send({ type: 'DELETE_THREAD', threadId })
    await rm(directory, { recursive: true, force: true })
  }
}
