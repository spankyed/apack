/**
 * Prompt template types and definitions
 */

// ── This feature's settings ───────────────────────────────────────────────
// Its own shape, which the app stores without knowing: the app owns the document, each feature its slice.
export type PromptsSettings = import('#generated/settings.ts').SettingsOf<'prompts'>;

/**
 * A window's writes to its prompts, each answered once: that it landed, or why it was refused. What a write changed
 * reaches every window through the views.
 */
export type PromptAsks = {
  CREATE_PROMPT: { args: { label: string; inputs: Record<string, any>; templateFn: string; outputSchema?: any; description?: string; category?: string } }
  UPDATE_PROMPT: { args: { promptId: string; label?: string; inputs?: Record<string, any>; templateFn?: string; outputSchema?: any; description?: string; category?: string } }
  DELETE_PROMPT: { args: { promptId: string } }
  /** Imported with what could not be, unless nothing could, which fails */
  IMPORT_PROMPTS: { args: { prompts: any }; answer: { count: number; errors?: string[] } }
  EXPORT_PROMPTS: { args: { directory: string }; answer: { filePath: string; promptCount: number } }
}

/** The prompts system sends no window anything of its own: the prompts are its views, and each ask is answered */
export type OutgoingPromptEvents = never
