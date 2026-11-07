// The broker's protocol, generated from `apack-terminal`'s Rust and committed here.
//
// **Generated, not written.** Regenerate with `TS_RS_EXPORT_DIR=protocol cargo test export_bindings` in the
// apack-terminal checkout and copy `protocol/protocol.ts` over this file's body. It is committed rather than
// read through `vendor/apack-terminal`, because that link is gitignored and machine-specific: typechecking
// this package must not require anyone to have the checkout.
//
// Phase B of the terminal-ownership goal turns this into a recorded artifact with `check`/`update` halves,
// so a protocol change nobody copied fails a typecheck instead of becoming a strange bug. Until then the
// pin in `vendor/apack-terminal.rev` and the `hello` handshake are what catch a mismatch — the second at
// runtime, with a `HANDSHAKE` refusal naming both versions.

/**
 * **A closed set, generated into the TypeScript as a string union** — elmdb's `ErrorCode` arrangement, and
 * what #372's name-matching should become. A caller switches on a value the compiler knows, rather than
 * matching on a message that is free to be reworded.
 */
export type ErrorCode = "HANDSHAKE" | "MALFORMED" | "NO_SUCH_SESSION" | "PTY";

/**
 * What the broker tells the app, unprompted or in answer.
 */
export type Event = { "kind": "hello", protocol: number, } | { "kind": "spawned", session: string, pid: number, } | { "kind": "output", session: string, data: string, } | { "kind": "exited", session: string, code: number | null, } | { "kind": "throttled", session: string, waited_ms: number, } | { "kind": "failed", session: string | null, code: ErrorCode, message: string, };

/**
 * What the app asks the broker to do.
 */
export type Request = { "kind": "hello", protocol: number, } | { "kind": "spawn", cols: number, rows: number, shell: string | null, cwd: string | null, } | { "kind": "write", session: string, data: string, } | { "kind": "resize", session: string, cols: number, rows: number, } | { "kind": "kill", session: string, };
