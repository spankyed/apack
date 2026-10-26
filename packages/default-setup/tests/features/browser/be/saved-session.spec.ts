// The browser surface restores its saved tabs and bookmarks as it starts, and only the window that asks is answered:
// each window owns the tabs it restored and syncs them back, so a restore sent to every window would replace the tabs
// another window is using
import { expect, it } from 'vitest'
import { startApp } from '@apackdev/testing/harness'
import { repository } from '#generated/repository.ts'

const BROWSER = 'default-setup/browser'

it('answers the window that asks with the saved session, and sends nothing on a connection', async () => {
  const app = await startApp({ systems: ['browser'] })
  await app.connect()
  repository.browserCommands.syncBookmarks([{ url: 'https://example.com', title: 'Example', favicon: '', displayOrder: 0 } as never])
  await app.settle()
  expect(app.emitted('browser'), 'no restore pushed to every window').toEqual([])

  const call = await app.send('browser', { type: 'GET_SAVED_SESSION' }, { sender: BROWSER, client: 'c-main' })
  const session = await app.nextEmit('browser', 'SAVED_SESSION_READ', { answering: call }) as unknown as { savedBookmarks: Array<{ url: string }> }
  expect(session.savedBookmarks.map((bookmark) => bookmark.url)).toEqual(['https://example.com'])
})
