# drive/

Run these npm scripts from the root of the apack source monorepo. This directory contains
app-contributor automation. External pack authors use `apack pack drive` in their pack repository.

Scripts that drive the app — navigate, send events, read state, screenshot.

**This is mainly for an agent.** It is how a coding agent debugs and develops against the app it is
changing: open what it just built, click through it, read the state back, screenshot it, and see for
itself whether the change worked. A person can use it the same way, and `npm run dev:drive` shows the app's
windows so you can watch — but the reason it exists is that an agent has no other way to look at a
running app.

**These are not tests.** Nothing here is collected by `npm test`, nothing gates on it, and a script that
asserts nothing is exactly right. This replaces `tests/e2e/scratch.spec.ts`, which was gitignored but sat
inside `testDir`, so the runner picked it up anyway.

```ts
// drive/notes.ts
import { drive } from '@apackdev/testing';

drive('open notes and look at it', async ({ app, appPage }) => {
  await app.navigate('notes');
  await app.screenshot('notes');
  // appPage is a Playwright Page: click, type, evaluate — whatever you need
});
```

```bash
npm run dev:drive                    # every script here, windows shown
npm run dev:drive -- drive/notes.ts  # just one
```

**It drives the *built* app**, loaded from `file://` — `npm run build:runtime` and `npm run build:default-setup` are what
put the thing you are looking at on disk, and the run warns when either has gone stale rather than
quietly showing you the previous build. So this is not the tool for a question about a dev server: nothing
here stands one up, and the source watcher servers from `npm run dev` are not in the picture.

**Every script here uses `npm run dev:drive --`.** The npm scripts use a repository-only entry point, so
`npm run dev:drive -- --help` is the reference. This runner always targets the app and never
installs a pack inferred from the working directory. Pack authors use `apack pack drive`.

**Each run gets a fresh data dir under `$TMPDIR` and throws it away**, so a script cannot touch your
development or production data, and every session starts clean. `--profile <name>` keeps a data dir
between sessions: `npm run dev:drive -- --profile probe`.

**For an answer you want to read rather than watch**, `app.report(name, value)` writes
`.apack/drive/results/<name>.json` and prints one `[drive:report] <name> <json>` line — so a program reading the
run does not have to grep for a prefix the script invented:

```ts
drive('how long the renderer takes', async ({ app, appPage }) => {
  const nav = await appPage.evaluate(() => performance.getEntriesByType('navigation')[0].toJSON());
  await app.report('startup', nav);
});
```

## One question

No script needed, and no session to stand up: a question is asked of the app `npm run dev` is holding, over
the debug port that app published.

```bash
npm run dev                                       # one terminal: source watchers and a drive session
# Or: npm run dev:open                                # hold the built app; no builds or watchers
npm run dev:state                               # another: 0.9s
npm run dev:eval -- 'return document.title'     # {"value":"Agent X","state":"attached",…}
npm run dev:query -- 'return query(EARS.Entity.Note).count()'
```

**It is a function body, not an expression** — so `return` is required, and a body without one answers no
value rather than failing. One JSON object on stdout and nothing else there: `value` is the answer, `state`
is `attached` or `spawned`, `startedBy` says whose app answered and `supervisorPid` is what ends it. The
app's output and any staleness warning go to stderr, and the exit code is the status — 0 with a value, 3
when no app is running, 1 when the verb failed. Headless, so no window appears for a question.

**With no app running it exits 3 and says so**, rather than starting one: a question should not acquire a
process nobody asked for. `--spawn` is how you ask, and the app it starts stays up, so a cold checkout
costs one flag on the first question and an attach on every one after.

```bash
npm run dev:state -- --spawn                    # 3.3s: starts the app, answers, leaves it running
npm run dev:state                               # 0.9s from then on
```

`apack profiles` says which data dirs have a live app and who started it, which is where a forgotten one
is found. `npm run dev:open --` takes the directory back from an app a question started.

## The verbs

`docs/public-facing/cli.md` has them all; the short version is `/eval` `/send` `/query` `/transact`
`/wait` `/navigate` `/surface` `/click` `/fill` `/press` `/logs` `/set-setting` `/set-viewport`
`/screenshot` `/reload` `/events` `/drops` `/errors`, and `state`, `snapshot`, `settings` and `viewport`.
The three the npm scripts expose are the three an agent reaches for most.

`/query` and `/transact` reach the **live** database, so a write shows up in the next read —
`apack db exec` writes from its own process and tells the app only when it ends.

A write does **not** show up in the UI. A surface holds what its system sent it, and a console write goes
round every system, so nothing tells the view. `/reload` is what makes every surface ask again; navigating
between surfaces does not, because the surface's actor survives.

An attached session has no window of its own, so a viewport it sets is Playwright's emulated one. A script
run, which shows the window, resizes the window itself — asking for a viewport there the other way would
letterbox the app against the desktop.

A pack author gets the same thing from `apack pack drive`, which also takes `--profile <name>` to keep the
app's data between sessions. In a pack everything here but this file and `playwright.config.ts` is
gitignored.

`playwright.config.ts` is a call to `@apackdev/testing/playwright`'s `defineDriveConfig`, so a setting lives
in the package rather than going stale in a copy here.
