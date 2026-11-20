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
  CREATE_PROMPT: { ask: { label: string; inputs: Record<string, any>; templateFn: string; outputSchema?: any; description?: string; category?: string } }
  UPDATE_PROMPT: { ask: { promptId: string; label?: string; inputs?: Record<string, any>; templateFn?: string; outputSchema?: any; description?: string; category?: string } }
  DELETE_PROMPT: { ask: { promptId: string } }
}

export type IncomingPromptEvents =
  | { type: 'IMPORT_PROMPTS'; prompts: any }
  | { type: 'EXPORT_PROMPTS'; directory: string }

/** What the prompts system answers with: an import's or an export's outcome. The prompts themselves are its views. */
export type OutgoingPromptEvents =
  | { type: 'PROMPTS_IMPORTED'; count: number; errors?: string[] }
  | { type: 'PROMPTS_IMPORT_FAILED'; errors: string[] }
  | { type: 'PROMPTS_EXPORTED'; filePath: string; promptCount: number }
  | { type: 'PROMPTS_EXPORT_FAILED'; errors: string[] }
