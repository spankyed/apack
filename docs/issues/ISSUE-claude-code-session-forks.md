# A "fork" that is really a second process on the same Claude Code session

**What goes wrong.** Resuming a session that is still running in another terminal does not fork it. It attaches a
second live process to the same session id. Both processes append to one transcript file, record their prompts
under one id, and share one scratchpad, job directory and edit history. Each process still sees only its own
conversation, so nothing looks wrong — until a restart. Then `/resume <id>` reopens one of the two conversations,
and the other has no session id of its own to open.

Claude Code 2.1.310. It has happened twice in this repo (below), and will happen again on any day with more than one
agent running.

## What happened on 2026-10-24

The disk-engine work behind PR #273 ran for 19 hours as a "fork" of session `1fb85317-1bf0-4f62-bd07-bc5acecb00bb`.
When the machine had to be restarted, that work could not be found by session id, by transcript file, or in the
`/resume` list. Its last review items had to be recovered by reading the raw transcript.

The sequence, from `~/.claude/history.jsonl` and the transcripts (times UTC):

| Time | Terminal | Command | Result |
|---|---|---|---|
| 01:11:34 | original (`1fb85317`) | `/status` | Gets the session id to fork |
| 01:11:47 | new (`da06f3b9`) | `/fork 1fb85317-…` | **Not a fork of `1fb85317`.** The argument becomes the first prompt of a background fork of the *current*, empty session: job `755e80a9`, which replies "That conversation didn't carry over to me" and blocks on a question. Never used again |
| 01:12:03 | new (`da06f3b9`) | `/resume 1fb85317-…` | **The defect.** The new terminal attaches to the live session. No warning, though the original is mid-turn |
| 01:12:08 | original | `/fork` (no argument) | Works as designed: background fork `cd09f242` with a new id, `forkParentSessionId` and a copy of the history (`~/.claude/jobs/cd09f242/state.json`) |
| 01:14 → 20:26 | both | — | Two processes write one transcript |

From then on, `1fb85317-….jsonl` is a tree with two live leaves:

- **Rows are interleaved.** Both processes wrote from 01:14 to the evening. In the part of the file each one still
  loads (after its latest compaction), the rows alternate between the two in 195 runs, often seconds apart.
- **The rows say which process wrote them, and nothing else does.** Every row carries `"sessionId": "1fb85317-…"`.
  Only a second field, `"session_id"`, differs: `1fb85317-…` for the original process and `da06f3b9-…` for the
  terminal that resumed it. The "fork" branch is 1,360 rows of `da06f3b9`; the other branch is 1,416 of `1fb85317`
  (plus 109 of `14d99146`, the process that resumed it after the restart).
- **`da06f3b9-….jsonl` holds 7 lines**: the `/fork` command and its output. Everything that process did after
  `/resume` is in the other session's file.
- **`history.jsonl` files both terminals' prompts under `1fb85317`.** Its prompt list for the day is the two
  conversations shuffled together.
- **Each process compacted on its own** (one at 08:20, the other at 09:05), so the two leaves share no recent
  ancestor a reader would recognise as a branch point.
- **After the restart, `/resume 1fb85317` opened the original's leaf.** The other leaf, with the PR #273 work and
  the PR #274 review, had no id to resume.

## What is shared, and why it matters beyond losing the thread

Everything keyed by the session id is shared by both processes:

- **The scratchpad** (`/private/tmp/claude-<uid>/<project>/<sessionId>/scratchpad`). Both wrote there (for example
  the second process's `ears-unit.txt` beside the first's chain logs). Two agents writing `pr-body.md` or
  `chain.log` there overwrite each other.
- **The job directory** (`~/.claude/jobs/1fb85317/`, `$CLAUDE_JOB_DIR`), including `tmp/`.
- **The edit checkpoints** (`~/.claude/file-history/1fb85317-…/`), which `/rewind` restores from. A rewind in one
  process can restore a file the other process edited. The other process's `docs/references/pr-274-review.md` is in
  this one's file history.
- **Prompt history.** Up-arrow recall in either terminal returns the other one's prompts too.
- **The session's links.** PRs opened by either process are attributed to the one session.

## The earlier occurrence

On 2026-10-05, `f122fdc5-84c9-467f-9c61-66330eab32d0.jsonl`: at 20:57:08 a new terminal (`1088de5f`) ran `/resume`
and attached while the original process (`acfdcbe9`) was still working. Both wrote the file from 20:59 to 21:27.

Found by scanning every transcript for two `session_id` values whose rows overlap in time. These two are the only
cases.

## How to fork

**Fork from inside the session.** Run `/fork` with no argument in the session's own terminal. That is the path that
worked (`cd09f242`): a background session with a new id, a copy of the history, and its parent recorded. Talk to it
with `ListAgents` / `SendMessage`, or attach to it with `claude --resume <its id>`.

**Fork from another terminal with `--fork-session`.** `claude --resume <id> --fork-session` copies the history into
a new session id. Without the flag, `--resume` and `/resume` attach to the same session.

**Never resume a session that may still be running.** Not with `/resume`, `claude --resume <id>` or `--continue`.
If in doubt, the original terminal's `/status` says whether it is live, and a transcript written in the last few
minutes is live. After a reboot nothing is running, so a plain resume is safe.

**`/fork <id>` does not fork session `<id>`.** The argument is the new fork's first prompt, and the fork copies the
session you typed it in. Typed into a fresh terminal, it forks nothing.

## How to recover a lost branch

A branch is lost when a transcript has rows from two `session_id` values that overlap in time. To make the other
branch resumable on its own:

1. **Find the leaves.** In the transcript, the rows no other row names as `parentUuid`, written after the overlap
   began. Group them by `session_id`; each writer's newest leaf is its conversation. Leaves of only a few rows are
   rewinds or edited prompts.
2. **Walk the branch.** From that leaf, follow `parentUuid` (and `logicalParentUuid` across a compaction) back to the
   writer's latest compaction boundary. That is all a resume loads.
3. **Copy it to a new session.** Write those rows, in file order, to `~/.claude/projects/<project>/<new-uuid>.jsonl`
   with `sessionId` set to the new id, and append a `{"type":"custom-title", …}` row so `/resume` lists it by name.
   Leave the original file alone.
4. **Open it** with `claude --resume <new-uuid>` from the same checkout.

The 2026-10-24 branch was recovered this way, as `0d164480-c7d8-480c-935e-af61fa67d0af` ("Disk engine fork
(PR 273) — recovered", 1,399 rows from its 09:05 compaction to its last turn at 20:26). A readable copy of its turns
is at `/private/tmp/claude-501/-Users-spankyed-Develop-Projects-AgentBuddy/1fb85317-1bf0-4f62-bd07-bc5acecb00bb/scratchpad/fork-conversation.md`.

## Path to resolution

1. **Habit, now.** Fork with `/fork` inside the session, or `--resume <id> --fork-session` from outside. Never a
   bare resume of a live session.
2. **A guard, in `~/.claude/settings.json`.** A `SessionStart` hook for the `resume` source that refuses to proceed
   quietly when another live process holds the session. On `startup` and `resume` it writes
   `~/.claude/session-locks/<session_id>` with the Claude process's pid (the hook's parent); on `resume` it first
   reads that file and, if the pid is alive and not its own, prints a warning naming the pid and the
   `--fork-session` command. That covers both cases above. It can only warn, not undo the attach, so the warning has
   to be impossible to miss.
3. **A recovery script.** The four steps above as `~/.claude/hooks/recover-session-branch.mjs <transcript>`:
   list each writer's leaves with their last prompt, and write a chosen one to a new resumable session.
4. **Upstream.** Report to Claude Code:
   - resuming a session another live process holds should refuse, or fork automatically;
   - `/fork <id>` should fork session `<id>`, or reject an argument that looks like a session id.

   The evidence is this document's two transcripts, the `session_id` field and the 01:11–01:12 sequence above.

Steps 2 and 3 are configuration and a script in `~/.claude`, outside this repo, and are not done yet.
