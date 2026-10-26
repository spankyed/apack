#!/usr/bin/env bash
# The half of the packaged-authoring check that needs no app: in a temp dir outside the monorepo, using only
# the packed @apackdev/* tarballs, author a pack, build it, test it on the harness, and release it to a
# verified archive. The app half runs that archive against a built app.
#
# Its own file rather than a mode, for `test-external-pack-contract.sh`'s reason: `check:tiers` reads a
# step's scripts as text, and a branch it never takes still reads as a reach at the app.
#
# Phases, and the end state they establish for outside pack authors
# (docs/archive/goals/goal-external-pack-authoring.md):
#   1. install @apackdev/cli + @apackdev/sdk (with @apackdev/ears) from tarballs
#   2. apack pack init -> add feature -> a flow using keepAlive from default-setup -> content from a format with a
#      .ts compiler module, default-setup's notes format, and the SDK's documents key -> an llm flow and a
#      service calling services.inference
#   3. apack pack build
#   4. unit tests on the harness, with inference mocked by mockInference
#   5. @apackdev/testing's published declarations type-check on their own (skipLibCheck off)
#   6. apack pack release --local --dry-run produces a verified archive (--skip-e2e: the app half runs that)
#   7. install that archive into an isolated test data dir
# Requires a built checkout's packages (npm run packages:build), not a built app.
# KEEP_WORK=1 is the app half's flag; this half always leaves its work dir, which is its declared output.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
. "$ROOT/tests/scripts/lib/authoring.sh"
# This run's work dir survives it: the chain caches a step on its declared `outputs` existing, and the app
# half reads the archive out of here. newWorkDir sweeps dead owners in this checkout only;
# the chain serializes this producer with its app consumer.
rm -rf "$HANDOFF"
WORK="$(newWorkDir)"
echo "Work dir: $WORK"
useWorkDir "$WORK"

step "Pack @apackdev/ears, @apackdev/sdk, @apackdev/ui, @apackdev/cli and @apackdev/testing"
# ensure, not build: it needs the tarballs to match the sources, which is what ensure guarantees, and it
# rewrites nothing when they already do. packages:build rebuilt all five unconditionally, which deleted and
# rewrote the dist/ that anything running beside this reads.
(cd "$ROOT" && npm run packages:ensure >/dev/null)
for dir in apack-ears/publish apack-sdk/publish apack-ui/publish apack-cli/dist/package apack-testing/dist/package; do
  (cd "$ROOT/packages/$dir" && npm pack --silent --pack-destination "$WORK" >/dev/null)
done
EARS_TGZ="$(ls "$WORK"/apackdev-ears-*.tgz)"
SDK_TGZ="$(ls "$WORK"/apackdev-sdk-*.tgz)"
UI_TGZ="$(ls "$WORK"/apackdev-ui-*.tgz)"
CLI_TGZ="$(ls "$WORK"/apackdev-cli-*.tgz)"
TESTING_TGZ="$(ls "$WORK"/apackdev-testing-*.tgz)"

step "1. Install @apackdev/cli + @apackdev/sdk from the tarballs"
# Every install revalidates npm's cached metadata, as a pack author's does: under `--prefer-offline`, metadata cached
# before a dependency's latest release names no such version, and npm skips an optional native package it can't find
# without an error (rollup's), so the build fails later for want of it
mkdir "$WORK/tools"
# The SDK's @apackdev/ears comes from its tarball too
(cd "$WORK/tools" && npm init -y >/dev/null && npm install --silent --no-audit --no-fund "$EARS_TGZ" "$SDK_TGZ" "$CLI_TGZ")
APACK="$WORK/tools/node_modules/.bin/apack"
"$APACK" --version

step "2. apack pack init → add feature"
cd "$WORK"
"$APACK" pack init demo-pack >/dev/null
PACK="$WORK/demo-pack"
cd "$PACK"
# The tarballs stand in for the npm registry
npm pkg set "dependencies.@apackdev/ears=file:$EARS_TGZ" "dependencies.@apackdev/sdk=file:$SDK_TGZ" "devDependencies.@apackdev/cli=file:$CLI_TGZ" "devDependencies.@apackdev/testing=file:$TESTING_TGZ"
npm install --silent --no-audit --no-fund
# @apackdev/sdk carries the platform API only; the component library and its editors come with @apackdev/ui
for lib in @tiptap highlight.js lowlight @guolao/vue-monaco-editor; do
  [ ! -e "node_modules/$lib" ] || fail "a backend-only pack installed $lib"
done
# From here on, `apack` is the pack's own pinned CLI
APACK="$PACK/node_modules/.bin/apack"
"$APACK" pack add feature notes --description "Manage notes." --label Notes >/dev/null
# @apackdev/ui's heavier components must build in a pack, not only in the monorepo
npm pkg set "dependencies.@apackdev/ui=file:$UI_TGZ"
npm install --silent --no-audit --no-fund
cat > src/features/notes/fe/editors.ts <<'TS'
import TiptapEditor from '@apackdev/ui/components/tiptap/TiptapEditor';
import SimpleMonacoEditor from '@apackdev/ui/components/SimpleMonacoEditor';

export const editors = { TiptapEditor, SimpleMonacoEditor };
TS
node -e '
  const fs = require("fs");
  const file = "src/features/notes/fe/state.ts";
  fs.writeFileSync(file, "import { editors } from \"./editors.ts\";\nconsole.debug(Object.keys(editors));\n" + fs.readFileSync(file, "utf8"));
'
"$APACK" pack init-tests
npm pkg set "devDependencies.@apackdev/testing=file:$TESTING_TGZ"
npm install --silent --no-audit --no-fund

step "Name the checkout the build resolves a shipped pack through"
# `apack pack build` reads a dependency on a shipped pack out of an app's `packages/` (fetch-deps'
# `configuredHostPackagesDir`), so something has to name an app before step 2 adds that dependency.
#
# **APACK_HOST for build commands; install selects the same host explicitly.** That function derives the apack checkout
# *behind the pack* when nothing names an app — and this pack is deliberately outside any checkout,
# installing the packages from packed tarballs, which is the population this script exists to represent.
# So the derivation correctly finds nothing here and the checkout has to be named. It used to be named by
# writing the first-run prompt's config file by hand; there is no prompt and no config file now.
#
# Per-command rather than exported, so step 8 still means something: `apack pack test` reads APACK_HOST like
# any other caller, and exporting it would hand that step a build without its asking. Left unset, step 8 has
# no build at all but the one it names on the command line — which is what makes it a check of hermeticity
# rather than a restatement of it.
BUILD_ENV=(env "APACK_HOST=$ROOT")

step "2. A flow using keepAlive from default-setup"
node -e '
  const fs = require("fs");
  const m = JSON.parse(fs.readFileSync("apack.json", "utf8"));
  m.dependencies = { "default-setup": "*" };
  fs.writeFileSync("apack.json", JSON.stringify(m, null, 2) + "\n");
'
cat > src/content/flows/notes-heartbeat.ts <<'EOF'
import { entry, keepAlive } from '#generated/flow-helpers.ts';

export default {
  "Notes Heartbeat": [
    entry([keepAlive()]),
  ],
};
EOF

step "2. Content from apack.json: a format with a .ts compiler module, default-setup's notes format and the SDK's documents"
mkdir -p src/content/glossary src/content/notes
printf -- '---\nterm: Pack\n---\nA bundle of features.\n' > src/content/glossary/pack.md
mkdir -p src/content/compilers
cat > src/content/compilers/glossary.ts <<'TS'
import { compileMarkdownTree, type ContentCompileContext, type ContentItem } from '@apackdev/sdk/build';

export default function compileGlossary({ path }: ContentCompileContext): ContentItem[] {
  return compileMarkdownTree(path).map((item) => ({ entity: 'DemoPack', term: String(item.frontmatter.term), definition: item.body.trim() }));
}
TS
printf -- '---\ntitle: Demo notes\n---\nWritten by demo-pack.\n' > src/content/notes/demo.md
mkdir -p src/content/documents/guides
printf -- '---\nname: Demo guides\n---\n' > src/content/documents/guides/_meta.md
printf -- '---\nname: Getting started\ntags: [demo]\n---\n<!-- section:text -->\nInstall demo-pack.\n' > src/content/documents/guides/start.md
# demo-notes uses default-setup's notes format, compiled from this pack's markdown through the built dependency;
# documents is the SDK's own key, which needs no dependency at all
node -e '
  const fs = require("fs");
  const m = JSON.parse(fs.readFileSync("apack.json", "utf8"));
  m.content.formats = { ...m.content.formats, glossary: { compiler: "src/content/compilers/glossary.ts", entity: "DemoPack", identity: ["term"] } };
  m.content.sources.glossary = { path: "src/content/glossary", format: "glossary" };
  m.content.sources["demo-notes"] = { path: "src/content/notes", format: "default-setup:notes" };
  m.content.sources.documents = "src/content/documents";
  fs.writeFileSync("apack.json", JSON.stringify(m, null, 2) + "\n");
'

step "2. An llm flow on default-setup's brain, and a service calling services.inference"
"$APACK" pack add prompt summarize-note >/dev/null
cat > src/content/prompts/summarize-note.ts <<'TS'
import type { PromptMeta } from '@apackdev/sdk/build';

export const meta: PromptMeta = {
  label: 'Summarize Note',
  description: 'Summarizes a note in one line.',
  category: 'notes',
  inputs: { text: { name: 'text', type: 'string', description: 'The note', required: true } },
};

export function template(params: Record<string, any>) {
  return `Summarize this note: ${params.text}`;
}
TS
cat > src/content/flows/notes-summary.ts <<'TS'
import { entry, keepAlive, on, llm } from '#generated/flow-helpers.ts';

export default {
  "Notes Summary": [
    entry([keepAlive()]),
    on('notes.summarize', [[
      llm('Summarize Note', { label: 'summarize', model: 'openai:gpt-4o-mini', map: { text: '$.event.data.payload.text' } }),
    ]]),
  ],
};
TS
"$APACK" pack add service digest --feature notes >/dev/null
cat > src/features/notes/be/services/digest.ts <<'TS'
import { Output } from 'ai';
import { z } from 'zod';
import { services } from '#generated/services.ts';

const Digest = z.object({ summary: z.string(), tags: z.array(z.string()) });

export const digestService = {
  async digest(text: string): Promise<z.infer<typeof Digest>> {
    const { output } = await services.inference.generateText({
      model: 'openai:gpt-5-mini',
      prompt: `Digest: ${text}`,
      output: Output.object({ schema: Digest }),
    });
    return output;
  },
};
TS
node -e '
  const fs = require("fs");
  const m = JSON.parse(fs.readFileSync("apack.json", "utf8"));
  m.consumes = { services: ["host/inference"] };
  m.content.sources = { prompts: "src/content/prompts", ...m.content.sources };
  fs.writeFileSync("apack.json", JSON.stringify(m, null, 2) + "\n");
'
# The digest service imports the AI SDK's pure pieces (Output); mockInference runs the AI SDK in tests
npm install --silent --no-audit --no-fund --save ai@^7.0.100

step "3. apack pack build"
"${BUILD_ENV[@]}" "$APACK" pack build | tee "$WORK/build.log"
node -e '
  const fs = require("fs");
  const read = (key) => JSON.parse(fs.readFileSync(`dist/runtime/content/${key}.content.json`, "utf8")).records;
  const [term] = read("glossary");
  if (term?.entity !== "DemoPack" || term.term !== "Pack" || term.definition !== "A bundle of features.") throw new Error("glossary: " + JSON.stringify(term));
  const [note] = read("demo-notes");
  // A record carries only what its source sets: defaults are applied when the row is created, so they are not tracked as written
  if (note?.entity !== "Note" || note.title !== "Demo notes" || "noteType" in note || "favorite" in note || !note.contentHash) throw new Error("demo-notes: " + JSON.stringify(note));
  // Sections and the _meta.md name come from the documents compiler of the SDK, not the generic walker
  const [guides] = read("documents");
  const [doc] = guides?.children ?? [];
  if (guides?.entity !== "Collection" || guides.name !== "Demo guides" || doc?.entity !== "Document"
    || JSON.stringify(doc.content) !== JSON.stringify([{ type: "text", text: "Install demo-pack." }])) throw new Error("documents: " + JSON.stringify(guides));
' || fail "the compiler modules and markdown content were not compiled"

step "4. Unit tests through the harness, with default-setup's runtime"
# A spec's path mirrors the source it covers, which is the layout `apack pack init` scaffolds and the one a
# pack author reads about (docs/public-facing/testing.md). These three cover the content, a feature's service
# and a written flow, so they go where those live.
mkdir -p tests/content/flows tests/features/notes/be/services
cat > tests/content/demo-notes.spec.ts <<'TS'
import { describe, expect, it } from 'vitest';
import { importContent } from '@apackdev/testing/harness';
import { query } from '#generated/ears.ts';
import { findRelations } from '@apackdev/sdk/ears';

describe('demo notes', () => {
  it("content notes with default-setup's format and hooks", async () => {
    expect(await importContent({ keys: ['demo-notes'] })).toEqual({ 'demo-notes': { created: 1, updated: 0, skipped: 0 } });
    const [note] = query('Note').pickAll();
    // hideCompletedChildren and lastSeen are what default-setup's note hooks write and a bare record doesn't carry
    expect(note).toMatchObject({ title: 'Demo notes', noteType: 'document', lastSeen: 0, hideCompletedChildren: false });
  });

  it("content documents with the SDK's documents key", async () => {
    expect(await importContent({ keys: ['documents'] })).toEqual({ documents: { created: 2, updated: 0, skipped: 0 } });
    const [guides] = query('Collection').pickAll();
    const [doc] = query('Document').pickAll();
    expect(doc.shortCode).toMatch(/^DOC-\d+$/);
    expect(guides).toMatchObject({ name: 'Demo guides' });
    expect(doc).toMatchObject({ name: 'Getting started', tags: ['demo'], content: [{ type: 'text', text: 'Install demo-pack.' }] });
    expect(findRelations({ source: guides.id, target: doc.id }).length).toBeGreaterThan(0);
  });
});
TS
cat > tests/features/notes/be/services/digest.spec.ts <<'TS'
import { describe, expect, it } from 'vitest';
import { mockInference } from '@apackdev/testing/harness';
import { services } from '#generated/services.ts';

describe('digest service', () => {
  it('digests a note from the structured output inference returns', async () => {
    const inference = mockInference(JSON.stringify({ summary: 'Buy milk', tags: ['errand'] }));
    expect(await services.digest.digest('Remember to buy milk')).toEqual({ summary: 'Buy milk', tags: ['errand'] });
    expect(inference.calls).toEqual([expect.objectContaining({ model: 'openai:gpt-5-mini', messages: [{ role: 'user', text: 'Digest: Remember to buy milk' }] })]);
  });
});
TS
cat > tests/content/flows/notes-summary.spec.ts <<'TS'
import { describe, expect, it } from 'vitest';
import { importFlows, mockInference, importContent, startApp } from '@apackdev/testing/harness';
import { entry, keepAlive, subflow } from '#generated/flow-helpers.ts';

describe('notes summary flow', () => {
  it("runs on default-setup's brain and llm step with inference mocked", async () => {
    await importContent({ keys: ['prompts', 'flows'] });
    const inference = mockInference('Buy milk');
    // A root flow hosting the pack's flow, as the app's root flow hosts long-running flows
    importFlows({ 'Root Flow': { root: true, tracks: [entry([subflow('Notes Summary')], [keepAlive()])] } });
    const app = await startApp({ systems: ['default-setup/brain', 'host/settings'] });

    const run = await app.runFlow('Notes Summary', { event: 'notes.summarize', data: { text: 'Remember to buy milk' } });

    expect(run.steps).toEqual([expect.objectContaining({ label: 'summarize', status: 'completed' })]);
    expect(run.steps[0].result).toMatchObject({ text: 'Buy milk' });
    expect(inference.calls).toEqual([expect.objectContaining({ model: 'openai:gpt-4o-mini', messages: [{ role: 'user', text: 'Summarize this note: Remember to buy milk' }] })]);
  });
});
TS
# Check authored types before execution; keep the unit summary uncoloured for the check below.
node_modules/.bin/tsc --noEmit
NO_COLOR=1 FORCE_COLOR=0 node_modules/.bin/vitest run 2>&1 | tee "$WORK/unit.log"
# The scaffold's content test (2), the feature's system test, default-setup notes, documents, the service and the flow
grep -qE "Tests +7 passed" "$WORK/unit.log" || fail "unit tests through the harness failed"
# The build prints an apply-file count even with no flows; check the compiled flow itself
node -e '
  const flows = JSON.parse(require("fs").readFileSync("dist/runtime/content/flows.content.json", "utf8"));
  const flow = flows["Notes Heartbeat"];
  if (!flow || !JSON.stringify(flow).includes("keep_alive")) throw new Error("the keepAlive flow was not compiled: " + JSON.stringify(flows));
' || fail "the keepAlive flow was not compiled"

step "5. @apackdev/testing's published types stand alone"
# Its declarations may import only what a pack installs: an unpublished import (@apackdev/host) fails with lib checking
# on, and is silently `any` under the scaffold's skipLibCheck. Errors in other packages' declarations aren't this check's.
cat > tests/types-probe.ts <<'TS'
import type { SurfaceEvent, TestApp, FlowRun } from '@apackdev/testing/harness';
import type { IsolatedDataDir } from '@apackdev/testing/vitest';
import type { AppDriver } from '@apackdev/testing';

type IsAny<T> = 0 extends 1 & T ? true : false;
export const typed: [IsAny<SurfaceEvent>, IsAny<Awaited<ReturnType<TestApp['nextEmit']>>>, IsAny<FlowRun>, IsAny<IsolatedDataDir>, IsAny<AppDriver>] = [false, false, false, false, false];
TS
TYPES_STATUS=0
node_modules/.bin/tsc --noEmit --skipLibCheck false --listFiles --pretty false -p . > "$WORK/types-probe.log" 2>&1 || TYPES_STATUS=$?
rm tests/types-probe.ts
# The diagnostics, without the files tsc lists
grep -v "^/" "$WORK/types-probe.log" || true
# tsc checked the probe: a config error (no inputs, a bad option) or a crash lists no files. tsc lists real paths.
grep -qxF "$(pwd -P)/tests/types-probe.ts" "$WORK/types-probe.log" || fail "tsc didn't type-check the types probe"
# Every error is in other packages' declarations (installed, or dependencies' in .apack/deps); errors without a
# file (config) or anywhere else fail.
# Don't widen these two prefixes to cover src/: a dependency's facade is inlined at
# src/__generated__/deps/<packId>.d.ts, and that path being outside the tolerance is what makes this step the proof
# that a peer its facade imports — zod today, through default-setup — resolves for a pack installed outside this
# monorepo. Forgiving src/ would swallow exactly that (apack-cli's facade-gate.ts says what rests on it).
if grep "error TS" "$WORK/types-probe.log" | grep -vE "^(node_modules|\.apack/deps)/" | grep .; then
  fail "the types probe didn't type-check"
fi
if grep -E "^node_modules/@apackdev/testing/" "$WORK/types-probe.log"; then
  fail "@apackdev/testing's published declarations don't type-check on their own"
fi
# A non-zero exit with no error in other packages' declarations is tsc failing some other way
if [ "$TYPES_STATUS" -ne 0 ] && ! grep -qE "^(node_modules|\.apack/deps)/[^(]+\([0-9]+,[0-9]+\): error TS" "$WORK/types-probe.log"; then
  fail "tsc exited $TYPES_STATUS without type errors while checking the types probe"
fi

step "6. apack pack release --local --dry-run"
git init --quiet -b main
git add -A
git -c user.name=author -c user.email=author@example.com commit --quiet -m "initial pack"
git remote add origin https://github.com/example/demo-pack.git
# The release runs a build of its own, so it needs the same naming
"${BUILD_ENV[@]}" "$APACK" pack release patch --local --dry-run --skip-e2e | tee "$WORK/release.log"
ARCHIVE="$(sed -n 's/^Pack: //p' "$WORK/release.log")"
[ -f "$ARCHIVE" ] && [ -f "$ARCHIVE.sha256" ] || fail "release did not produce an archive and checksum"
(cd "$(dirname "$ARCHIVE")" && shasum -a 256 -c "$(basename "$ARCHIVE").sha256")
[ -z "$(git status --porcelain)" ] || fail "a dry run changed the pack's files"

step "7. Install the packed archive into an isolated test data dir"
DATA="$WORK/test-data"
APACK_USER_DATA_DIR="$DATA" "$APACK" pack install "$ARCHIVE" --host "$ROOT"
INSTALLED="$(find "$DATA" -path '*/demo-pack/integrity.json' | head -n 1)"
[ -n "$INSTALLED" ] || fail "the pack was not installed"
node -e '
  const b = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
  // The version on disk: a dry run bumps nothing, so it packs what is there rather than the next version
  if (b.id !== "demo-pack" || b.version !== "0.1.0") throw new Error(`unexpected pack ${b.id}@${b.version}`);
' "$INSTALLED"
[ -f "$(dirname "$INSTALLED")/runtime/index.cjs" ] || fail "installed pack has no runtime"


# What the app half needs, and nothing it can derive for itself. The archive's digest is in here so that
# half's cache key moves when the build does: a re-authored pack is a different thing to test.
step "Hand the archive to the app half"
writeAuthoringHandoff

_step_report
echo
echo "External pack authoring, author half: OK (${SECONDS}s)"
