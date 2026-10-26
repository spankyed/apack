/**
 * Prompt template types and definitions
 */

// ── This feature's settings ───────────────────────────────────────────────
// Its own shape, which the app stores without knowing: the app owns the document, each feature its slice.
export type PromptsSettings = import('#generated/settings.ts').SettingsOf<'prompts'>;

export type IncomingPromptEvents =
  | { type: 'CREATE_PROMPT'; label: string; inputs: Record<string, any>; templateFn: string; outputSchema?: any; description?: string; category?: string }
  | { type: 'UPDATE_PROMPT'; promptId: string; label?: string; inputs?: Record<string, any>; templateFn?: string; outputSchema?: any; description?: string; category?: string }
  | { type: 'DELETE_PROMPT'; promptId: string }
  | { type: 'IMPORT_PROMPTS'; prompts: any }
  | { type: 'EXPORT_PROMPTS'; directory: string }

/** What the prompts system answers with: an import's or an export's outcome. The prompts themselves are its views. */
export type OutgoingPromptEvents =
  | { type: 'PROMPTS_IMPORTED'; count: number; errors?: string[] }
  | { type: 'PROMPTS_IMPORT_FAILED'; errors: string[] }
  | { type: 'PROMPTS_EXPORTED'; filePath: string; promptCount: number }
  | { type: 'PROMPTS_EXPORT_FAILED'; errors: string[] }
