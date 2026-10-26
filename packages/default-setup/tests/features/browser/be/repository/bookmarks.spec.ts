// Syncing bookmarks: the window's list replaces what was stored, a page with no favicon included
import { describe, expect, it } from 'vitest'
import { startApp } from '@apackdev/testing/harness'
import { repository } from '#generated/repository.ts'
import { query, EARS } from '#generated/ears.ts'

describe('syncBookmarks', () => {
  it('replaces the stored bookmarks with the list, storing a page with no favicon with an empty one', async () => {
    await startApp({ systems: [] })
    repository.browserCommands.syncBookmarks([{ url: 'https://old.example', title: 'Old', favicon: 'old.ico', displayOrder: 0 }])
    repository.browserCommands.syncBookmarks([{ url: 'https://example.com', title: 'Example', displayOrder: 0 }])
    expect(query(EARS.Entity.BrowserBookmark).pickAll().map(({ url, favicon }) => ({ url, favicon })))
      .toEqual([{ url: 'https://example.com', favicon: '' }])
  })
})
