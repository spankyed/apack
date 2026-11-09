import type { ElectronApplication } from 'playwright'

type ClipboardPayload = { kind: 'blob'; data: string } | { kind: 'bookmark'; title: string; url: string }
export type ClipboardSnapshot = Array<Record<string, ClipboardPayload>>

/** Preserve every original MIME entry across an actual-app clipboard journey. */
export function readClipboardSnapshot(app: ElectronApplication): Promise<ClipboardSnapshot> {
  return app.evaluate(async ({ clipboard }) => Promise.all((await clipboard.read()).map(async item => {
    const entries = await Promise.all(item.types.map(async type => {
      if (type === 'electron application/bookmark') {
        const bookmark = await item.getType('electron application/bookmark')
        return [type, { kind: 'bookmark' as const, title: bookmark.title, url: bookmark.url }] as const
      }
      const blob = await item.getType(type)
      if (!('arrayBuffer' in blob)) throw new Error('Expected clipboard Blob for ' + type)
      return [type, { kind: 'blob' as const, data: Buffer.from(await blob.arrayBuffer()).toString('base64') }] as const
    }))
    return Object.fromEntries(entries)
  })))
}

export function restoreClipboardSnapshot(app: ElectronApplication, saved: ClipboardSnapshot, onlyIfText?: string): Promise<void> {
  return app.evaluate(async ({ clipboard, ClipboardItem }, { saved, onlyIfText }) => {
    if (onlyIfText !== undefined && await clipboard.readText() !== onlyIfText) return
    if (!saved.length) { clipboard.clear(); return }
    await clipboard.write(saved.map(item => new ClipboardItem(Object.fromEntries(Object.entries(item).map(([type, payload]) => [type,
      payload.kind === 'bookmark' ? { title: payload.title, url: payload.url }
        : new Blob([Buffer.from(payload.data, 'base64')], { type }),
    ])))))
  }, { saved, onlyIfText })
}

export function readClipboardPng(app: ElectronApplication) {
  return app.evaluate(async ({ clipboard, nativeImage }) => {
    const items = await clipboard.read(), item = items.find(item => item.types.includes('image/png'))
    if (!item) throw new Error('Clipboard has no PNG image')
    const png = Buffer.from(await (await item.getType('image/png')).arrayBuffer())
    return { formats: [...new Set(items.flatMap(item => item.types))], size: nativeImage.createFromBuffer(png).getSize(), png: png.toString('base64') }
  })
}
