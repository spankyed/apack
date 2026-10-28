import { createRequire } from 'node:module';

interface CompiledRegex {
  isMatch(text: string): boolean;
  free(): void;
}
interface RegexBinding {
  RRegex: new (pattern: string) => CompiledRegex;
  folded(text: string): string;
  contains(text: string, needle: string): boolean;
  containsFolded(text: string, needle: string): boolean;
  requiredLiteral(pattern: string): string | undefined;
}

/** The pattern owns its Rust allocation and must be closed after the synchronous read, including refusals. */
export interface SqlitePattern {
  readonly literal?: string;
  matches(text: string): boolean;
  close(): void;
}

/** Loading is lazy and synchronous. The root/package imports do not load WASM or read its runtime assets. */
export function createRegexCompiler(): {
  compile(pattern: string): SqlitePattern;
  substring(text: string, caseInsensitive: boolean): SqlitePattern;
  fold(text: string): string;
} {
  let binding: RegexBinding | undefined;
  // Resolve beside the package in both src/ and dist/. The published tree includes the same vendor assets.
  const load = () => binding ??= createRequire(import.meta.url)('../../vendor/rregex/rregex.cjs') as RegexBinding;
  return {
    fold(text) { return load().folded(text); },
    substring(text, caseInsensitive) {
      const b = load(), folded = b.folded(text);
      let prefix = '', count = 0, open = true;
      for (const character of folded) { prefix += character; if (++count === 32) break; }
      return {
        literal: count >= 3 && !folded.includes('\0') ? prefix : undefined,
        matches(value) {
          if (!open) throw Object.assign(new Error('The compiled pattern is closed'), { code: 'CLOSED' });
          return caseInsensitive ? b.containsFolded(value, folded) : b.contains(value, text);
        },
        close() { open = false; },
      };
    },
    compile(pattern) {
      binding = load();
      let regex: CompiledRegex;
      try { regex = new binding.RRegex(pattern); }
      catch (error) {
        // A runtime/loader failure is not an invalid user pattern. Rust's ordinary syntax/size refusals are.
        if (!(error instanceof Error) || error instanceof WebAssembly.RuntimeError ||
            !/regex parse error|Compiled regex exceeds size limit/.test(error.message)) throw error;
        throw Object.assign(new Error(`matching ${JSON.stringify(pattern)}: ${error.message}`, { cause: error }),
          { code: 'PATTERN_INVALID' });
      }
      let literal: string | undefined;
      try { literal = binding.requiredLiteral(pattern); }
      catch (error) { regex.free(); throw error; }
      let open = true;
      return {
        literal,
        matches(text) {
          if (!open) throw Object.assign(new Error('The compiled pattern is closed'), { code: 'CLOSED' });
          return regex.isMatch(text);
        },
        close() { if (open) { open = false; regex.free(); } },
      };
    },
  };
}
