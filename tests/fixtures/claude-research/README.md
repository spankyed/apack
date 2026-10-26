# Claude research replay tools

`runner.tgz` contains only authored research tools from the commit in `manifest.json`.
It contains no recovered Claude implementation, native binary, private traffic, credentials or
`node_modules`. The fixture is generated, not a second maintained copy of the research tools.

Regenerate from the research checkout after committing its tools:

```sh
python3 tools/export-ci-replay.py /absolute/path/to/apack/tests/fixtures/claude-research
```

The current runner includes Settings freshness observation and cloud-consent saved verification.
Cloud-consent acceptance uses a private previously saved forwarding preference and leaves the native
feature gates unchanged. Its profile requires the owned offline-container receipt at
`/control/offline-verified` and the pinned executable mounted read-only at `/frozen-claude/claude`;
setting `CLAUDE_RESEARCH_SETTINGS_REMOTE_HOME=1` without that boundary fails closed. The accepted
scope covers withdrawal, complete disclosure/choices, Not now/header cancellation, keep-local,
native eligibility refusal and recovery. Successful forwarding and actual cloud sending remain
unverified. These milestones use local Linux execution; no CI is dispatched.

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
