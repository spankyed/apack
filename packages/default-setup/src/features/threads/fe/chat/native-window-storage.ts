export function claudeWindowStorageKey(kind: 'parent-draft' | 'composer-phase', owner: string, search = globalThis.location?.search ?? ''): string | undefined {
  const query = new URLSearchParams(search), surface = query.get('surfaceId')
  // WindowManager keeps one main window and one popout per surface.
  if (query.get('popout') === 'surface' && !surface) return
  return `claude-${kind}:` + JSON.stringify([query.get('popout') === 'surface' ? ['surface', surface] : ['main'], owner])
}
