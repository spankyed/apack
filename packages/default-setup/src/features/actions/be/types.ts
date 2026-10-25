// ── This feature's settings ───────────────────────────────────────────────
// Its own shape, which the app stores without knowing: the app owns the document, each feature its slice.
export interface Category {
  name: string;
  color: string; // Hex color value
}

export type ActionsSettings = import('#generated/settings.ts').SettingsOf<'actions'>;

export type IncomingActionEvents =
  | { type: 'CREATE_ACTION'; label: string; input: Record<string, any>; actionFn: string; output?: any; description?: string; category?: string }
  | { type: 'UPDATE_ACTION'; actionId: string; label?: string; input?: Record<string, any>; actionFn?: string; output?: any; description?: string; category?: string }
  | { type: 'DELETE_ACTION'; actionId: string }
  | { type: 'IMPORT_ACTIONS'; actions: any }
  | { type: 'EXPORT_ACTIONS'; directory: string }

/** What the actions system answers with: an import's or an export's outcome. The actions themselves are its views. */
export type OutgoingActionEvents =
  | { type: 'ACTIONS_IMPORTED'; count: number; errors?: string[] }
  | { type: 'ACTIONS_IMPORT_FAILED'; errors: string[] }
  | { type: 'ACTIONS_EXPORTED'; filePath: string; actionCount: number }
  | { type: 'ACTIONS_EXPORT_FAILED'; errors: string[] }
