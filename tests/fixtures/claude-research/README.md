# Claude research replay tools

`runner.tgz` contains only authored research tools from the commit in `manifest.json`.
It contains no recovered Claude implementation, native binary, private traffic, credentials or
`node_modules`. The fixture is generated, not a second maintained copy of the research tools.

Regenerate from the research checkout after committing its tools:

```sh
python3 tools/export-ci-replay.py /absolute/path/to/apack/tests/fixtures/claude-research
```

The runner also contains the current completion-navigation, managed-model precedence, document
producer/paste and Workflow Resume/layout tooling. These profiles use the authored
`probeApackControls` entry in `src/integration/run-apack-controls.mjs`; the named case list in the
older launcher is not the complete profile catalog. For the latest Workflow journey, call that
entry inside the prepared, locked Linux container with:

- `CLAUDE_RESEARCH_PENDING_WORKFLOW=1`
- `CLAUDE_RESEARCH_WORKFLOW_TASK_CONTROLS=1`
- `CLAUDE_RESEARCH_WORKFLOW_RESUME=1`
- `CLAUDE_RESEARCH_WORKFLOW_RESUME_ELIGIBILITY=1`
- Kind `terminal-plan-app-task-controls`, the checkout and read-only pinned executable paths,
  and new private workspace/output directories as its four other arguments.

Use `CLAUDE_RESEARCH_COMPLETION_NAVIGATION=1` with kind `terminal-plan-app-theme` for the
main/Agent completion journey. Execute only after verifying network isolation, the read-only
Linux 2.1.302 binary, 6 GiB memory/equal swap and two-CPU limits; hold the owned app-run lock.
These current delivery profiles use local Linux validation and do not dispatch CI. The scoped
Workflow result captures and completion journeys do not establish all F1–F5 acceptance.

The plugin-recommendation profile uses `CLAUDE_RESEARCH_PLUGIN_HINT` (`no`, `yes`, `disable`,
`timeout`) with kind `terminal-plan-app-theme`. Prepare its genuine optional source input with
`node src/artifacts/official-marketplace.mjs <snapshot-directory>` before entering the offline
runner; set `CLAUDE_RESEARCH_PLUGIN_HINT_SNAPSHOT` to that directory inside the container.
The tool pins official commit `dbd4588f9e1033efb41dad4bef2f7947c8993d44`, disables Git hooks and
verifies complete objects/metadata. Native registration and any selected installation use only a
private HOME and offline Git mirror. The original privacy/essential-traffic gate is preserved;
ordinary fixture mode removes only the generic runner's injected suppression switch. Use
`verifyNativePluginHintAppEvidence` from `src/protocol/native-plugin-hint-app-proof.mjs` on the
exported data, captures and read-only database query. Set `CLAUDE_RESEARCH_TRANSCRIPT_RESIZE=1`
for the optional normal/compact latest-reply and top-of-history reading journey; verify it with
`verifyNativeTranscriptViewportAppEvidence` from `src/protocol/native-transcript-viewport-app-proof.mjs`.
Use `verifyNativeRecommendationLayoutAppEvidence` from the same module for compact reply/footer
space and original defer/expiry recovery. Other notice kinds, arbitrary reader anchors and whole-screen
polish remain separate. This is scoped app acceptance, not full parity.

The optional `CLAUDE_RESEARCH_BASH_ADMISSION_TRACE=1` plugin-recommendation profile records original
Bash admission, projection and control replies without retries or pre-click waits. Use
`verifyNativeBashChoiceAppEvidence` and `verifyNativeBashStandingAppEvidence` from
`src/protocol/native-bash-choice-proof.mjs` for the corresponding saved app evidence;
`reconstructBashPrefixTokenFailure` preserves the old snapshot comparison and its missing-error limit.
Bash responses use the selected choice's token; the parent token tracks presentation refresh only.

The current runner includes Settings freshness observation and cloud-consent saved verification.
Cloud-consent acceptance uses a private previously saved forwarding preference and leaves the native
feature gates unchanged. Its profile requires the owned offline-container receipt at
`/control/offline-verified` and the pinned executable mounted read-only at `/frozen-claude/claude`;
setting `CLAUDE_RESEARCH_SETTINGS_REMOTE_HOME=1` without that boundary fails closed. The accepted
scope covers withdrawal, complete disclosure/choices, Not now/header cancellation, keep-local,
native eligibility refusal and recovery. Successful forwarding and actual cloud sending remain
unverified. These milestones use local Linux execution; no CI is dispatched.

The runner also includes the scoped rich parent/Agent round-trip verifier. Its private app profile
uses `CLAUDE_RESEARCH_PROMPT_THEME=rich-selection`, `CLAUDE_RESEARCH_AGENT_REFERENCE=1` and
`CLAUDE_RESEARCH_AGENT_ROUNDTRIP=1`; it requires the same offline receipt/read-only executable
boundary and refuses the startup-only profile. Acceptance compares exact drafts and owner reads,
source-normalized parent Send, original parent/worker journals and model requests, parent-only PNG
bytes, ten normal/compact captures and same-session recovery. It does not add Agent binary-media
support or establish full parity. The accepted visual refinement covers full image previews,
form-bounded formatting menus and real-wheel reading of the complete marked/reference message.

The pending-read broker-loss refinement uses the original prompt-timeout fixture with
`CLAUDE_RESEARCH_PROMPT_TIMEOUT=1` and `CLAUDE_RESEARCH_PROMPT_BROKER_FAILURE=1`. It holds genuine
addressed WebSocket replies, kills only its owned broker, verifies original process retirement and
fresh-owner recovery, then delivers the old frame while a new reply stays held. Four normal/compact
captures and the original journal/model receipts support this parent-read scope; other operations,
windows and automatic return-focus remain separate. Its saved verifier can run without native code.

The exporter uses committed Git blobs, normalized archive metadata and per-file SHA-256 hashes.
The replay launcher verifies the archive and every file, downloads the explicitly pinned official
native package and checks both package and binary hashes before execution. Local native execution
uses the Linux container and `linux-arm64.json`; macOS native execution requires a disposable
GitHub-hosted runner. The user's installed CLI and settings are never used.

Run the selected local native journey through the isolated checkout's Linux runner:

```sh
npm run test:linux -- bash tests/fixtures/claude-research/linux-app.sh native-mcp-form-app
npm run test:linux -- bash tests/fixtures/claude-research/linux-app.sh native-mcp-browser-return-app
npm run test:linux -- bash tests/fixtures/claude-research/linux-app.sh native-mcp-legacy-browser-app
npm run test:linux -- bash tests/fixtures/claude-research/linux-app.sh native-mcp-retry-browser-app
npm run test:linux -- bash tests/fixtures/claude-research/linux-app.sh pdf-pages-app
npm run test:linux -- bash tests/fixtures/claude-research/linux-app.sh system-policy-app
```

The Linux runner already prepares published packages and the platform-specific default pack.
The fixture launcher installs missing display prerequisites and uses the build-chain cache to refresh
only the app runtime. Research replay uses one locked directory at `/work/.claude-research/current`.
Copy needed evidence out before the next sync/replay; it replaces this directory. Do not restore
the old unbounded `node_modules/.cache/claude-research-linux` layout.

Use CI only when Linux cannot cover the selected platform-specific behavior, and dispatch only
the selected journey on the existing PR branch:

```sh
gh workflow run ci.yml --repo spankyed/apack --ref session/claude-code-research \
  -f claude_research=true -f claude_research_case=agent-source
```

Available app cases: `agent-source`, `field-bounds`, `source-fill`, `everyday`,
`action-keys-app`, `action-contexts-app` `action-dialog-app` and `action-panes-app`. The dialog case holds an
original shortcut-triggered question through human deliberation, checks normal/compact answering
and restored shortcut use, then requires same-session recovery and owned shutdown.
`native-action-keys` and `native-action-contexts` run only the original terminal configured-action discovery baseline,
skipping both app builds. It does not establish ordinary-composer support.
`agent-and-fields` runs the Agent baseline and field milestone sequentially from one candidate build. These replay existing scoped journeys;
they do not establish full feature parity or replace final F1–F5 acceptance. CI retains original
run records, proofs, synthetic model requests, screenshots and traces. Download and inspect the
resulting artifact before claiming app acceptance on that runner.
