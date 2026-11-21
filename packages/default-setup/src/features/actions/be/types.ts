// ── This feature's settings ───────────────────────────────────────────────
// Its own shape, which the app stores without knowing: the app owns the document, each feature its slice.
export interface Category {
  name: string;
  color: string; // Hex color value
}

export type ActionsSettings = import('#generated/settings.ts').SettingsOf<'actions'>;

/**
 * A window's writes to its actions, each answered once: that it landed, or why it was refused. What a write changed
 * reaches every window through the views.
 */
export type ActionAsks = {
  CREATE_ACTION: { args: { label: string; input: Record<string, any>; actionFn: string; output?: any; description?: string; category?: string } }
  UPDATE_ACTION: { args: { actionId: string; label?: string; input?: Record<string, any>; actionFn?: string; output?: any; description?: string; category?: string } }
  DELETE_ACTION: { args: { actionId: string } }
  /** Imported with what could not be, unless nothing could, which fails */
  IMPORT_ACTIONS: { args: { actions: any }; answer: { count: number; errors?: string[] } }
  EXPORT_ACTIONS: { args: { directory: string }; answer: { filePath: string; actionCount: number } }
}

/** The actions system sends no window anything of its own: the actions are its views, and each ask is answered */
export type OutgoingActionEvents = never
