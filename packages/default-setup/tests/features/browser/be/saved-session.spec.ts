// The browser surface restores its saved tabs and bookmarks as it starts, and only the window that asks is answered:
// each window owns the tabs it restored and syncs them back, so a restore sent to every window would replace the tabs
// another window is using
import { expect, it } from 'vitest'
import { startApp } from '@apackdev/testing/harness'
import { repository } from '#generated/repository.ts'

it('answers the window that asks with the saved session, and sends nothing on a connection', async () => {
  const app = await startApp({ systems: ['browser'] })
  await app.connect()
  repository.browserCommands.syncBookmarks([{ url: 'https://example.com', title: 'Example', favicon: '', displayOrder: 0 } as never])
  await app.settle()
  expect(app.emitted('browser'), 'no restore pushed to every window').toEqual([])

  const session = await app.ask('browser', { type: 'GET_SAVED_SESSION' }, { client: 'c-main' })
  expect(session.ok && (session.value as { savedBookmarks: Array<{ url: string }> }).savedBookmarks.map((bookmark) => bookmark.url))
    .toEqual(['https://example.com'])
  expect(app.emitted('browser'), 'nor the answer to any other window').toEqual([])
})
