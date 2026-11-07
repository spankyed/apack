/** Original stream notices are display-only and carry their own native identity. */
export function projectClaudeUiLog(value: unknown, sessionId: string | undefined) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return
  const row = value as Record<string, unknown>
  if (row.type !== 'system' || row.subtype !== 'ui_log' || !sessionId || row.session_id !== sessionId
    || typeof row.uuid !== 'string' || !/^[a-f0-9-]{36}$/i.test(row.uuid)
    || typeof row.plugin !== 'string' || !row.plugin || typeof row.text !== 'string') return
  return { uuid: row.uuid, sessionId, plugin: row.plugin, text: `${row.plugin}: ${row.text}` }
}
