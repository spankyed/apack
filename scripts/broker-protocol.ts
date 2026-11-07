// The broker's protocol as a recorded file: `protocol:check` re-derives it and compares, `protocol:update`
// writes it.
//
// **The derivation is `cargo test export_bindings` in the linked checkout**, not a comparison against a file
// an earlier command left — which is this repo's rule for a recorded file and the reason this is not a hash
// of `apack-terminal`'s source. The answer is re-taken: ts-rs is asked to generate the declarations again
// from the Rust types, into a temporary directory, and what comes out is held against
// `packages/apack-host/src/broker/protocol.ts`.
//
// **It says so when it could not look.** `vendor/apack-terminal` is a gitignored, machine-specific symlink,
// so a checkout that has not run `npm run link:apack-terminal` cannot derive anything — and a check that
// quietly passed there would be a check that reports nothing because it looked at nothing. It reports the
// skip on its result line instead, which is one of the four shapes a partial result is allowed to take. The
// pin and the `hello` handshake remain the other two guards: a stale pin is a `HANDSHAKE` refusal naming
// both versions at runtime.
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { REPO_ROOT } from '@apackdev/host/build/packages-built';

/** Where the app keeps its copy, and the file this check is about */
const RECORDED = path.join(REPO_ROOT, 'packages/apack-host/src/broker/protocol.ts');
/** The link and the commit it is pinned to */
const CHECKOUT = path.join(REPO_ROOT, 'vendor/apack-terminal');
const PIN = path.join(REPO_ROOT, 'vendor/apack-terminal.rev');

/**
 * The header the recorded file carries, which is written here rather than preserved from the file.
 *
 * One writer: a header kept by reading the old file around a generated body is a second source for the
 * prose, and the first edit that moves a line of it silently keeps the old one.
 */
const HEADER = `// The broker's protocol, generated from \`apack-terminal\`'s Rust and committed here.
//
// **Generated, not written.** \`npm run protocol:update\` re-derives it from the linked
// \`vendor/apack-terminal\` checkout; \`npm run protocol:check\` re-derives it and fails if this file has
// fallen behind, and runs as part of \`npm run typecheck\`. It is committed rather than read through the
// checkout, because that link is gitignored and machine-specific: typechecking this package must not
// require anyone to have it.
//
// What catches a mismatch nobody could check for: the pin in \`vendor/apack-terminal.rev\`, and the \`hello\`
// handshake at runtime, which refuses with \`HANDSHAKE\` naming both versions.
`;

function linkedCheckout(): string | undefined {
  try {
    const resolved = fs.realpathSync(CHECKOUT);
    return fs.statSync(resolved).isDirectory() ? resolved : undefined;
  } catch {
    return undefined;
  }
}

/** Refuses a checkout that is not at the commit this repo pins, because what it would derive is not ours */
function atThePin(checkout: string): void | never {
  const pinned = fs.readFileSync(PIN, 'utf8').trim();
  const head = execFileSync('git', ['-C', checkout, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  if (head !== pinned) {
    // A refusal, printed rather than thrown: whoever reads it has one thing to do, and a stack trace through
    // this file is not part of it
    console.error(
      `❌ vendor/apack-terminal is at ${head.slice(0, 12)}; vendor/apack-terminal.rev pins ${pinned.slice(0, 12)}.`,
    );
    console.error('   What it would generate is not what this repo pins, so nothing was compared.');
    console.error('   Move the checkout to the pin, or bump the pin in the change that moves it.');
    process.exit(1);
  }
}

/** The declarations ts-rs generates now, from the Rust types in the linked checkout */
function derive(checkout: string): string {
  const into = fs.mkdtempSync(path.join(os.tmpdir(), 'apack-protocol-'));
  try {
    execFileSync('cargo', ['test', 'export_bindings'], {
      cwd: checkout,
      env: { ...process.env, TS_RS_EXPORT_DIR: into },
      stdio: 'pipe',
    });
    const written = fs.readdirSync(into);
    if (written.length !== 1 || written[0] !== 'protocol.ts') {
      throw new Error(`the export wrote ${written.join(', ') || 'nothing'}; expected protocol.ts alone`);
    }
    return fs.readFileSync(path.join(into, 'protocol.ts'), 'utf8');
  } finally {
    fs.rmSync(into, { recursive: true, force: true });
  }
}

const update = process.argv.includes('--update');
const checkout = linkedCheckout();

if (!checkout) {
  if (update) {
    console.error('protocol:update needs the broker checkout: run `npm run link:apack-terminal` first.');
    process.exit(1);
  }
  console.log('✅ protocol:check — not derived here: vendor/apack-terminal is not linked (`npm run link:apack-terminal`)');
  process.exit(0);
}

atThePin(checkout);
const wanted = `${HEADER}\n${derive(checkout)}`;
const recorded = fs.existsSync(RECORDED) ? fs.readFileSync(RECORDED, 'utf8') : '';

if (wanted === recorded) {
  console.log(`✅ protocol:check — ${path.relative(REPO_ROOT, RECORDED)} matches the pinned broker`);
  process.exit(0);
}

if (update) {
  fs.writeFileSync(RECORDED, wanted);
  console.log(`✅ protocol:update — rewrote ${path.relative(REPO_ROOT, RECORDED)} from the pinned broker`);
  process.exit(0);
}

console.error(
  `❌ ${path.relative(REPO_ROOT, RECORDED)} is not what the pinned broker generates. Run \`npm run protocol:update\`.`,
);
const recordedLines = recorded.split('\n');
const wantedLines = wanted.split('\n');
for (let line = 0; line < Math.max(recordedLines.length, wantedLines.length); line++) {
  if (recordedLines[line] !== wantedLines[line]) {
    console.error(`  line ${line + 1}:`);
    console.error(`    recorded: ${recordedLines[line] ?? '(end of file)'}`);
    console.error(`    derived:  ${wantedLines[line] ?? '(end of file)'}`);
  }
}
process.exit(1);
