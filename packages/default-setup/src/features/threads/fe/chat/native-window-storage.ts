export function claudeWindowStorageKey(kind: 'parent-draft' | 'composer-phase', owner: string, search = globalThis.location?.search ?? ''): string | undefined {
  const query = new URLSearchParams(search), plugin = query.get('pluginId')
  // WindowManager keeps one main window and one popout per plugin.
  if (query.get('popout') === 'plugin' && !plugin) return
  return `apack.claude-${kind}:` + JSON.stringify([query.get('popout') === 'plugin' ? ['plugin', plugin] : ['main'], owner])
}
