/**
 * Reading a config's *code*, for the question "does this still delegate to the helper?"
 *
 * It has to be the code and not the text, because the configs this is asked about carry a comment
 * explaining the helper by name — so a plain `source.includes('defineDriveConfig')` answers yes for a
 * config that went back to assembling its own and kept the comment. `@app/internal-repo-checks`'
 * `pack-test-config.spec.ts` records that its first mutation run was fooled by exactly that.
 */

/** A source file's code, with block comments, line comments and nothing else removed */
export function codeOf(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => {
      // Quote-aware, so a `//` inside a string literal is not read as the start of a comment
      let quote: string | null = null;
      for (let i = 0; i < line.length; i += 1) {
        const ch = line[i]!;
        if (quote !== null) {
          if (ch === '\\') i += 1;
          else if (ch === quote) quote = null;
        } else if (ch === '\'' || ch === '"' || ch === '`') quote = ch;
        else if (ch === '/' && line[i + 1] === '/') return line.slice(0, i);
      }
      return line;
    })
    .join('\n');
}

/** Whether a config's code calls one of these helpers, rather than merely naming one in a comment */
export function configCallsHelper(source: string, helpers: readonly string[]): boolean {
  const code = codeOf(source);
  return helpers.some((helper) => new RegExp(`\\b${helper}\\s*\\(`).test(code));
}
