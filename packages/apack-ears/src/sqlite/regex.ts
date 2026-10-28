import { createRequire } from 'node:module';

interface CompiledRegex {
  isMatch(text: string): boolean;
  free(): void;
}
interface RegexBinding { RRegex: new (pattern: string) => CompiledRegex }

/** The pattern owns its Rust allocation and must be closed after the synchronous read, including refusals. */
export interface SqlitePattern {
  matches(text: string): boolean;
  close(): void;
}

/** Loading is lazy and synchronous. The root/package imports do not load WASM or read its runtime assets. */
export function createRegexCompiler(): { compile(pattern: string): SqlitePattern } {
  let binding: RegexBinding | undefined;
  return {
    compile(pattern) {
      // Resolve beside the package in both src/ and dist/. The published tree includes the same vendor assets.
      binding ??= createRequire(import.meta.url)('../../vendor/rregex/rregex.cjs') as RegexBinding;
      let regex: CompiledRegex;
      try { regex = new binding.RRegex(pattern); }
      catch (error) {
        // A runtime/loader failure is not an invalid user pattern. Rust's ordinary syntax/size refusals are.
        if (!(error instanceof Error) || error instanceof WebAssembly.RuntimeError ||
            !/regex parse error|Compiled regex exceeds size limit/.test(error.message)) throw error;
        throw Object.assign(new Error(`matching ${JSON.stringify(pattern)}: ${error.message}`, { cause: error }),
          { code: 'PATTERN_INVALID' });
      }
      let open = true;
      return {
        matches(text) {
          if (!open) throw Object.assign(new Error('The compiled pattern is closed'), { code: 'CLOSED' });
          return regex.isMatch(text);
        },
        close() { if (open) { open = false; regex.free(); } },
      };
    },
  };
}
