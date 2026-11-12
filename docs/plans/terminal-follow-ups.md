# Terminal follow-ups: the hand-off plan

Status: planned, 2026-11-12. Nothing in it is started. Written to be carried out by an agent that has
not seen the conversation it came from, so everything it needs is here or is a file this names.

## Read this first (for whoever hands this off)

Seventeen follow-up items were listed. This plan sorts them into three piles. Change the sorting here
before handing off if you disagree; the agent is told not to.

**Pile 1: work for the agent (this plan's stages).**

| Item | Where it is done |
|---|---|
| Control characters 0x80–0x9F in a marker | Stage A, task A1. Measured on 2026-11-12: they do **not** break a marker. The work is the test that pins it. |
| `Rendering::look`'s unused return value | Stage A, task A2 |
| The pre-push check runs mutants one at a time | Stage A, task A3 |
| The broker repository tracks a `.DS_Store` (found while planning) | Stage A, task A4 |
| The app's pin is behind the broker's `master` | Stage B, task B1 |
| No committed end-to-end test for vouched marks | Stage C, task C1 |
| bash 5.1, 5.3 and bash-preexec untested | Stage C, task C2 |
| No mutation pass since the orphan fix | Stage C, task C3 |
| The full chain never run on the vouched-marks change | Stage C, task C4 |

**Pile 2: closed with no code, each for a reason.** The agent is told to leave these alone.

| Item | Why no work | What would reopen it |
|---|---|---|
| Ubuntu/Debian bash records no text for a command re-run straight after itself | Under `HISTCONTROL=ignoreboth` bash's history cannot tell that line from a hidden one, and the hook that prints the start runs before bash has named a command. The record's number and exit code are right. Every fix is worse: rewriting the user's history settings, or a new marker type across both repositories and the recording format | A reader that needs the text, not the outcome |
| macOS bash 3.2: a subshell-only line is unmarked, a subshell-first line starts late | bash before 4.4 has no hook that runs for those lines. macOS's default shell is zsh, which marks every line | Nothing can; it is the shell's limit |
| bash's start marker is lost when stderr is redirected | An interactive bash with stderr redirected also prints no prompt and no echo of what is typed. Nobody uses a shell in that state | — |
| PowerShell: the secret is inherited by programs the profile starts | Inheriting the secret is harmless unless that program forges markers, and a program that does is hostile local code, which the design states it does not stop. Fixing it means loading the user's profiles ourselves, a behaviour change nobody can test without Windows | A Windows machine to test on, and a reason to care |
| A record's directory means "where the command ended" in a protected session and "where it began" in an unprotected one | Nothing reads the field. Making it one meaning needs recordings to store one more value, which changes the recording file's layout | The first reader of the field, which then says which meaning it needs |
| Three mutation exclusions cover real behaviour (a retry that would spin a thread, the 50,000-image listing bound, a stale entry in the list of recordings) | Each exclusion's written reason holds. The first needs a CPU reading to observe, the second needs 50,000 images, and a test of the third would restate the code | A way to observe each from outside the process |
| Two failures seen once each with no proven cause (`killing_a_session_takes_the_whole_tree_with_it`, and one recording-restore case in `tests/keeping.rs`) | Neither reproduced: 416 and 320 reruns passed. More reruns buy nothing | Either failing again. The agent's instructions say what to capture if one does |
| The saturating-producer test takes about 10 seconds | By design: it reads slowly on purpose so that a busy machine cannot make it pass or fail for the machine's reasons. A faster version brings that flakiness back | — |

**Pile 3: not for this hand-off. These need you.**

- **Nothing consumes command outcomes yet.** That first consumer (a flow or an agent that acts on
  "the build passed") is a product decision. When it is built it must use `commandSucceeded`
  (`@apackdev/sdk/services`) and treat `unknown` and `claimed` as *not* a success.
- **The shell hooks have never run on Windows.** Needs the Azure Windows VM.
- **The elmdb checkout is 123 commits past its pin** on a working branch. Not terminal work.

**Done since this was first written, outside the hand-off.** Both are merged on the broker and reach
the app with the pin in Stage B:

- **The broker's event queue and its one writer**: `spankyed/apack-terminal#11`. Each client has a
  bounded queue and a writer of its own; one that reads nothing is hung up on past 64 MiB, and the
  broker's bookkeeping waits on no client.
- **Gutter colour**: `spankyed/apack-terminal#12`. A status of zero is green whoever reported it.

**The plan runs start to finish with nobody in it.** The agent opens its own pull requests and merges
them itself once the checks named at each merge have passed. It stops only where a rule says a check
failed.

---

# For the agent

## What this is about

Two repositories on this machine:

| Repository | Path | What it is |
|---|---|---|
| `spankyed/apack` ("the app", "the monorepo") | `/Users/spankyed/Develop/Projects/apack/monorepo` | An Electron app. TypeScript. Read its `CLAUDE.md` before changing anything |
| `spankyed/apack-terminal` ("the broker") | `/Users/spankyed/Develop/Projects/apack/apack-terminal` | A Rust program that owns every terminal's pty and interprets its output. Its `view/` folder is the TypeScript a window draws a terminal with. Read its `CLAUDE.md` and `docs/architecture/testing.md` |

The app depends on the broker through a symlink, `vendor/apack-terminal`, and names the exact broker
commit it is built against in `vendor/apack-terminal.rev` ("the pin").

**Vouched marks**, which several tasks touch: a shell in an app terminal prints invisible markers
("a command started", "it ended with status 0"). The broker keeps a record per command from them.
Anything that prints can print a marker, so the app gives each shell a secret key, the shell's hook
prints two keyed, numbered markers, and the broker takes a keyed session's records only from those.
The full description is `docs/references/vouched-shell-marks.md` in the app. Read it once.

```
ESC ] 633 ; V ; S ; <number> ; <key> ; <command line> BEL      a command started
ESC ] 633 ; V ; F ; <number> ; <key> ; <status> ; <directory> BEL   it ended
```

State on 2026-11-12, to check rather than trust:

- The broker's `master` is `f3e7346` or later. It includes `spankyed/apack-terminal#10` (a watcher that
  ends brokers the proxy tests start), which task C3 depends on and checks for, and `#11` and `#12`.
  The suite is about 435 cases.
- The app's `master` pins the broker at `efe5d84`.
- A strict CI run on the app, `43155648309`, was queued on commit `14bec84`, which includes the
  vouched-marks change. Task C4 reads its result.

## Rules. Every one is a hard rule.

**Where you work**

1. Never edit, build or run anything in the two main checkouts named above. Work only in the
   worktrees the setup steps create.
2. Never `git stash`. The stash is shared between worktrees.
3. Never switch a worktree to a branch another worktree has checked out.
4. Never push to `master`. A change reaches it through a pull request you open (not as a draft) and
   then merge yourself, **only** when every check named at that merge has passed. You have permission
   to merge your own two pull requests and no others.
   - Merge with a merge commit, never a squash or a rebase: `gh pr merge <number> --merge`. The app
     names a broker commit, and a squash leaves it naming a commit no branch holds.
   - A check that failed is a reason to stop and report (rule 17), not to merge anyway, retry until
     green, or change the check.

**Commits and pull requests**

5. No attribution lines of any kind in a commit message or PR body: no `Co-Authored-By`, no
   "Generated with", no session links.
6. One commit per task. `git add` only the files that task names. Never `git add -A` at the
   repository root.
7. Do not edit version numbers, changelogs or release files. Do not change `PROTOCOL_VERSION`,
   `PACK_SNAPSHOT_FORMAT` or `PACK_LAYOUT_VERSION`.

**Processes**

8. Never end a process by pattern: no `pkill`, no `killall`, no `ps | grep | kill`. End only a
   process whose PID you captured when you started it. If a process is left running and you have no
   such PID, list it in your report and leave it.
9. A Docker container you start gets a name beginning `follow-ups-`, and is stopped and removed by
   that name. Touch no other container.
10. One heavy job at a time on this machine: a mutation run, a full test suite, a build or a chain.
    Never two at once. Two at once made tests time out and report false results.
11. Run anything likely to take over two minutes in the background, and wait for it once. Do not poll.

**Code and tests**

12. Comments say what is true of the thing, for someone opening the file cold. Never the history of
    the change ("now", "used to", "added for"), and never a mention of this plan, of mutation
    testing, or of who asked.
13. Test names are sentences, as their neighbours' are. A test states behaviour and would still pass
    if the code were rewritten correctly another way. No assertions over source text.
14. No backward compatibility: change a name outright and move every caller in the same commit.
15. Never raise a timeout, weaken an assertion or skip a test to get a pass. If something fails that
    this plan says should pass, stop and report what you saw.
16. Node must be 24.12 or later for any `npm` command (`node -v`).

**When to stop**

17. Stop and report, without improvising, when: a step's command fails twice the same way; a check
    this plan says passes does not; a task would need a file this plan does not name; or one of the
    two once-seen failures recurs (see *If an old failure comes back*).
18. Do none of the items in Pile 2 or Pile 3 above, even if they look easy.

## Your report

One message at the very end, or at the point you stopped:

- Each task: done or not, the commit, and the check you ran with its real result line.
- Every decision you made that this plan did not make for you, one line each.
- Everything you left behind: worktrees, branches, containers, downloaded files, running processes.
- Anything that failed or that you could not verify, plainly.

---

## Stage A: the broker (one branch, one PR, four commits)

### Setup

```bash
cd /Users/spankyed/Develop/Projects/apack/apack-terminal
git fetch origin
git worktree add -b chore/terminal-follow-ups ../apack-terminal-worktrees.noindex/follow-ups origin/master
cd ../apack-terminal-worktrees.noindex/follow-ups
```

Every shell command that builds or tests needs the terminal core's prebuilt library in its
environment first, in the same command:

```bash
eval "$(cargo xtask vt-prebuilt 2>/dev/null | grep '^export')" && cargo nextest run
```

The suite is one test program: `tests/suite.rs` declares each file under `tests/` as a module, so a
case in `tests/vouched.rs` is `vouched::<name>`. Run one module with `-E 'test(/^vouched::/)'` and
one case with `-E 'test(=vouched::<name>)'`. The whole suite is about 426 cases in about 13 seconds.

### A1. A marker holding a control character above ASCII is carried whole

**Why.** The shell hooks percent-encode the control characters 0x00–0x1F and 0x7F in a command line,
so none can end the marker early. They do not encode the second set, 0x80–0x9F, one of which (0x9C)
is a "string terminator" in the terminal standard. On 2026-11-12 all 32 were fed to the broker inside
a keyed start, both as UTF-8 text and as single raw bytes, and every marker was read whole. So the
hooks need no change. What is missing is the test that keeps it true when the terminal core is
upgraded.

**Do.** Add this case to the end of `tests/vouched.rs`. Its helpers (`keyed`, `start`, `finish`,
`records`, `record`, `EXITED_0`, `KEY`) are already at the top of that file.

```rust
/// **A line holding one of the second set of control characters is carried whole.** A shell's hook
/// encodes the first set and leaves these, U+0080 to U+009F, as they are; one of them ends a string
/// in the standard a terminal follows, and a core that took it so inside this mark would cut the line
/// there and read the rest as text on the screen. As the character and as the single byte, since a
/// program can print either.
#[test]
fn a_line_holding_a_control_character_above_ascii_is_carried_whole() {
    for code in 0x80u32..=0x9f {
        let character = char::from_u32(code).expect("a code point");
        let line = format!("echo a{character}b");
        let mut screen = keyed();
        screen.feed(start(1, &line).as_bytes());
        screen.feed(finish(1, "0", "/tmp").as_bytes());
        assert_eq!(records(&mut screen), vec![record(1, &line, Some("/tmp"), EXITED_0)], "U+{code:04X}");

        let mut bytes = format!("\x1b]633;V;S;1;{KEY};echo a").into_bytes();
        bytes.push(u8::try_from(code).expect("one byte"));
        bytes.extend_from_slice(b"b\x07");
        let mut screen = keyed();
        screen.feed(&bytes);
        screen.feed(finish(1, "0", "/tmp").as_bytes());
        let commands = records(&mut screen);
        let [(_, Some(carried), _, outcome)] = commands.as_slice() else {
            panic!("the byte {code:#04x} left {commands:?}")
        };
        assert_eq!(*outcome, EXITED_0, "the byte {code:#04x}");
        assert!(carried.starts_with("echo a") && carried.ends_with('b'), "the byte {code:#04x} left {carried:?}");
    }
}
```

**Done when** `cargo nextest run -E 'test(=vouched::a_line_holding_a_control_character_above_ascii_is_carried_whole)'`
passes. If it fails, do not change the test or the broker: stop and report which code failed. That
would be news, and it changes what the hooks must do.

**Commit:** `test: a line holding a control character above ASCII is carried whole`

### A2. `Rendering::look` returns nothing, because nothing reads what it returned

**Why.** `Rendering::look` (`src/vt/rows.rs`) fills a list, `changed`, with one flag per row, or
leaves it empty when the whole screen may have changed. It also returns an enum, `Changed`, saying
the same thing. Its one caller in the product (`src/view/publish.rs`, `self.rendering.look(...)?;`)
ignores the return value and reads the list. Only a test reads the enum.

**Do.**

1. In `src/vt/rows.rs`: change `look` to return `Result<(), Failed>`, delete the `Changed` enum, and
   fix the doc comment so it says what an empty `changed` means.
2. In `tests/vt.rs` (near line 253) four assertions compare `look`'s result with
   `Ok(Changed::Everything)` or `Ok(Changed::Rows)`. Read the case. Rewrite each to call `look`,
   require `Ok(())`, and assert on `changed` itself: empty where it expected `Everything`, and not
   empty where it expected `Rows`. Remove the `Changed` import.
3. Search for any other use: `grep -rn "Changed" src tests`. There should be none left that mean
   this enum.

**Done when** `cargo clippy --workspace --all-targets -- -D warnings` is clean and
`cargo nextest run -E 'test(/^vt::/)'` passes.

**Commit:** `refactor: a look at the terminal says what changed in one place`

### A3. The pre-push check runs the change's mutants in parallel

**Why.** `cargo xtask pre-push` runs `cargo mutants --in-diff` with no `--jobs`, so mutants are
tested one at a time. Every full pass on this machine was run at four jobs, which is the widest
setting measured to be reliable; CI runs two per runner.

**Do.** In `xtask/src/pre_push.rs`, function `mutants_of_the_change`:

1. Add a small function that answers how many jobs to use: half the machine's cores
   (`std::thread::available_parallelism()`), at least 1 and at most 4. Give it a doc comment saying
   why four is the top: a pass was measured reliable at four, and wider made cases that start real
   processes wait on the machine and fail for mutants that never reached them.
2. Pass `--jobs <n>` to the `cargo mutants` command there.
3. `xtask/tests/` holds the tasks' own cases. Add one that states the two edges that matter: a
   one-core machine runs one job, and a machine with many cores runs four. To make that testable,
   have the function take the core count as an argument and let the caller read the machine.
4. If `docs/architecture/testing.md` or `CLAUDE.md` says pre-push runs mutants one at a time, fix the
   sentence. `grep -n "pre-push" docs/architecture/testing.md CLAUDE.md`.

**Done when** `cargo nextest run --workspace` passes, including the new xtask case.

**Commit:** `fix(xtask): pre-push tests the change's mutants several at a time`

### A4. The repository does not track a `.DS_Store`

`git ls-files | grep DS_Store` prints one file. Remove it from the index and ignore it:

```bash
git rm --cached .DS_Store
grep -qx '.DS_Store' .gitignore || printf '.DS_Store\n' >> .gitignore
```

**Commit:** `chore: .DS_Store is ignored`, adding only `.gitignore` and the removal.

### Before you push Stage A

Alone on the machine, once:

```bash
eval "$(cargo xtask vt-prebuilt 2>/dev/null | grep '^export')" && cargo xtask pre-push
```

It runs format, lint, the suite, the generated-file checks, and the mutants of your change. It must
pass. A surviving mutant is in code you changed: answer it with a test that states behaviour. Do not
add an exclusion to `.cargo/mutants.toml`; if you think one is right, stop and say why in your report.

Afterwards list brokers left without a parent (this only lists):

```bash
ps -axo pid,ppid,etime,command | awk '$2==1 && /target\/(mutants|debug)\/apack-terminal/'
```

It should print nothing. If it prints anything, put the lines in your report and leave the processes.

Then:

```bash
git push -u origin chore/terminal-follow-ups
gh pr create --base master --title "Four follow-ups: a control-character case, one unused return value, parallel pre-push mutants, .DS_Store" --body "<what each commit does and the check that passed, in plain sentences>"
```

**Merge it yourself once its checks pass.** The broker's CI runs on every pull request. Wait for it
in one command, which returns when every check has finished and fails if any did:

```bash
gh pr checks <number> --watch --fail-fast
```

- All passed: `gh pr merge <number> --merge`, then go straight on to Stage B.
- Any failed: read the failing job's log (`gh run view <run-id> --log-failed`). If the failure is in
  code you changed, fix it, push, and wait again, at most twice. If it is not in code you changed, or
  it fails a third time, stop and report. Do not merge.

---

## Stage B: the app's pin (straight after you merge the Stage A PR)

### Setup

Confirm the merge first: `git -C /Users/spankyed/Develop/Projects/apack/apack-terminal fetch origin`
and check that `git log origin/master --oneline -8` shows the Stage A commits. If it does not, the
merge did not happen: stop and report.

Move the Stage A worktree to the merged `master` and build the broker binary the app will run:

```bash
cd /Users/spankyed/Develop/Projects/apack/apack-terminal-worktrees.noindex/follow-ups
git checkout --detach origin/master
git rev-parse HEAD            # this is the new pin; keep it
eval "$(cargo xtask vt-prebuilt 2>/dev/null | grep '^export')" && cargo xtask package
```

Make the app worktree (about five minutes: it installs and builds):

```bash
cd /Users/spankyed/Develop/Projects/apack/monorepo
git fetch origin
npm run session:new -- terminal-follow-ups origin/master
```

It prints the new directory, `../monorepo-worktrees.noindex/terminal-follow-ups`, on branch
`session/terminal-follow-ups`. Everything below runs there. Check
`git log --oneline origin/master..HEAD` prints nothing before you start.

### B1. The app is built against the broker's `master`

1. Write the pin: put the commit from `git rev-parse HEAD` above, and a newline, in
   `vendor/apack-terminal.rev`.
2. Point this worktree's link at the broker worktree you just built:

   ```bash
   APACK_TERMINAL_DIR=/Users/spankyed/Develop/Projects/apack/apack-terminal-worktrees.noindex/follow-ups npm run link:apack-terminal
   ```

   It refuses a checkout that does not hold the pin, and says so. A warning about the pin is a
   reason to stop.
3. Check: `npm run typecheck`, then `npm run chain -- --no-native` (run it in the background; it can
   take 20 to 40 minutes cold). Both must pass. The chain prints one result line; quote it.

**Commit:** `chore(vendor): the broker at its master`, adding only `vendor/apack-terminal.rev`. Say in
the message what the broker gained since `efe5d84`, from
`git -C <broker worktree> log --oneline efe5d84..HEAD`.

Do not push yet. Stage C adds to this branch.

**For your report:** the main checkout's sibling at
`/Users/spankyed/Develop/Projects/apack/apack-terminal` will be behind the new pin until its owner
runs `git pull` there. Say so. Do not do it.

---

## Stage C: the validation gaps (same app branch, after B1)

### C1. A committed end-to-end case: a forged finish ends nothing in the real app

**Why.** Each joint is tested separately (the hooks against real shells, the broker against
generated input, the app against a stand-in broker). The only proof that the real app, the real hook
and the real broker agree was a one-off script. This is that proof as a kept case.

**What can be observed from a window.** The terminal's right-click menu has *Copy Last Command
Output* (`[data-terminal-menu="copy-output"]`). It carries `data-disabled` until the window has been
told of a command that has ended. In a protected session, markers a program prints end nothing, so
the item stays disabled while that program runs. In an unprotected one, a printed `133;D;0` would end
the command and enable it. That difference is the test.

**Do.** In `tests/e2e/app-integration/terminal-view.spec.ts`, after the case
`'the commands a shell runs are marked, and text on its screen is found'`, add a case. Read that
case and the helpers at the top of the file (`openTerminal`, `type`, `screen`) first, and copy their
style and their waits exactly.

The case, in order:

1. `openTerminal`. It must be a new terminal, so that it has no ended command yet.
2. Type one line that prints forged finishes, then two visible words a second apart, then waits:

   ```
   printf '\033]133;D;0\007\033]633;D;0\007\033]133;A\007'; echo fir$((1+1))st; sleep 1; echo sec$((1+1))ond; sleep 600
   ```

   (In the TypeScript string each backslash is doubled, as the neighbouring cases do.)
3. Wait until the screen shows `sec2ond`. That word is printed a second after the forged markers, so
   by then the window has been told whatever the broker made of them.
4. Right-click the terminal, wait for the menu item to be visible, and assert it **has**
   `data-disabled`. Message: a finish a program printed ended the command. Close the menu
   (press Escape).
5. Focus the terminal's `textarea` and press `Control+C`, which ends the `sleep`.
6. As the neighbouring case does with `toPass`, right-click and assert the item does **not** have
   `data-disabled`. That is the shell's own keyed finish arriving.

Name it as a sentence, for example
`'a finish a program prints ends nothing, and the shell\'s own does'`, with a doc comment that
says what is true: a command is over when the shell that ran it says so with the key it was given.

**Run it.** The suite drives the *built* app, so build first (each build is a few minutes; one at a
time):

```bash
npm run build:default-setup && npm run build:runtime
npm run test:e2e -- terminal-view
```

**Prove it can fail.** Once it passes, make the app stop giving shells a key and see the case fail:

1. In `packages/default-setup/src/features/code/be/services/terminal.ts` find
   `const marksKey = integration?.keyed ? randomBytes(16).toString('hex') : undefined` and
   temporarily make it `const marksKey = undefined`.
2. `npm run build:default-setup && npm run build:runtime`, then run the case. It must fail at step 4.
3. Restore the line with `git checkout -- packages/default-setup/src/features/code/be/services/terminal.ts`,
   rebuild both, and run the case again. It must pass.

If it does not fail at step 4 with the key removed, the case proves nothing: stop and report.

**Also run** `npm run typecheck`. Every clock-based wait in a test file is checked against a list
(`scripts/lib/test-timeouts.ts`); if the check refuses your new waits, do what its message says.
Reuse the timeouts the neighbouring cases already use.

**Commit:** `test(e2e): a finish a program prints ends nothing in a real terminal`, adding only the
spec file (and the timeouts list if the check required it).

### C2. The bash hook on bash 5.1 and 5.3, and with bash-preexec

**Why.** The hook was run for real on bash 3.2, 4.4.20, 5.0.17, 5.2.15 and 5.2.37. Not on 5.1 or
5.3, and not with bash-preexec loaded (a common add-on that takes over bash's hooks; the hook has a
branch for it that has never run).

`packages/default-setup/tests/features/code/be/services/shell-marks.spec.ts` runs every bash it finds
in its `BASHES` list. This machine has only `/bin/bash` (3.2). The other versions were reached by a
small script that *is* a bash as far as the spec can tell, and runs the real one in a container.

**Do, for 5.1 and then 5.3.** Docker (OrbStack) must be running. Pulling the two official images
`bash:5.1` and `bash:5.3` is allowed.

1. Save this as `bash-in-container` in your scratch directory, `chmod +x` it, and set `IMAGE`:

   ```sh
   #!/bin/sh
   # A bash from a container image, run as if it were a bash on this machine: the same arguments
   # and standard input, the caller's directory, and the caller's home mounted where it is here.
   # What bash writes to standard error is joined to its standard output inside the container,
   # because the two leave a container as separate streams and lose their order.
   IMAGE=bash:5.1
   case ${HOME-} in
     /private/var/folders/*|/var/folders/*|/private/tmp/*|/tmp/*) set -- -v "$HOME:$HOME" -e "HOME=$HOME" -- "$@" ;;
     *) set -- -- "$@" ;;
   esac
   mounts=
   while [ "$1" != -- ]; do mounts="$mounts $1"; shift; done; shift
   exec /usr/local/bin/docker run --rm -i --name "follow-ups-bash-$$" $mounts \
     ${APACK_MARKS_KEY:+-e "APACK_MARKS_KEY=$APACK_MARKS_KEY"} -e "TERM=${TERM:-dumb}" -w "$PWD" \
     --entrypoint bash "$IMAGE" -c 'exec bash "$@" 2>&1' bash "$@"
   ```

2. Temporarily add the script's full path to the `BASHES` list in the spec.
3. `npm run spec -- packages/default-setup/tests/features/code/be/services/shell-marks.spec.ts`
4. Write down, per version: how many cases passed, failed and skipped, and the name of any failure.
   On a bash with `PS0` (4.4 and later) the three cases that skip under 3.2 should run.
5. Remove your line from `BASHES` (`git checkout --` the spec file) before going on.

**Then bash-preexec, on bash 3.2 and on one container bash.**

1. Download one pinned file into your scratch directory (this download is allowed):
   `https://raw.githubusercontent.com/rcaloras/bash-preexec/0.5.0/bash-preexec.sh`
2. In the spec, inside the bash `describe`, temporarily add one case that reads that file's text and
   passes it as the `bashrc` argument of the existing `typed(bashrc, lines)` helper, with the lines
   `echo one`, `false`, `(exit 3)`, `echo two | cat; echo three`, and prints what `typed` returns.
3. Run the spec. In what it printed, each of the four lines should have one start marker
   (`633;V;S;<n>;<key>;<line>`) carrying the whole line, and one finish (`633;V;F;<n>;<key>;<status>;…`)
   with statuses `0`, `1`, `3`, `0`, and the numbers should count up by one. Under bash 3.2 the line
   `(exit 3)` may have no start: that is the known limit of that version, not a failure.
4. Remove the case and the `BASHES` line. `git status` must show the spec file unchanged.

**A failure here is a finding, not something to fix.** Do not edit the hook
(`shell-integration.ts`). Record what failed and stop the task.

**Record the results** by adding a short dated subsection under `## Vouched shell marks` in
`docs/goals/evidence/terminal-view.md`: a table of version, what was run, and the result, in the
style of the table already there, and remove 5.1, 5.3 and bash-preexec from that section's
"Not run" sentence if they ran clean.

Remove your containers by name if any are left (`docker ps -a --filter name=follow-ups-`).

**Commit:** `docs: the bash hook on 5.1 and 5.3 and under bash-preexec`, adding only the evidence doc.

### C3. A mutation pass leaves no broker running

**Needs** `spankyed/apack-terminal#10` merged. Check in the broker worktree:
`grep -c ending_with_the_case tests/reaper.rs` must print 1 or more on `origin/master`. If it prints
0, skip this task and say so.

**Why.** A mutation pass edits the broker one small change at a time and runs the suite against each.
Some of those changes break the rule by which a broker exits, and the tests' own cleanup could not
reach brokers that the `proxy` command had started. Two such brokers were found running eight hours
after a pass. #10 adds the cleanup. No pass has been run since to show it works.

**Do,** in the broker worktree from Stage B (on the merged `master`), alone on the machine, in the
background. The files named are the ones that hold the exit rules:

```bash
eval "$(cargo xtask vt-prebuilt 2>/dev/null | grep '^export')" && \
  cargo mutants --jobs 4 --no-shuffle -f src/main.rs -f src/listening.rs -f src/proxy.rs
```

Expect 10 to 20 minutes. Do not start anything else until it ends. It exits 0 when every mutant was
caught, 2 when one survived and 3 when one timed out; none of those is a failure of *this* task.

When it has ended:

```bash
ps -axo pid,ppid,etime,command | awk '$2==1 && /target\/mutants\/apack-terminal/'
cargo xtask clear-mutants
```

**Done when** the first command prints nothing. If it prints processes, the fix has a hole: copy the
lines into your report, leave the processes running, and stop. Do not end them.

Report the pass's own totals (caught, missed, timeout, unviable) and the names in
`target/mutants.out/missed.txt`, but do not act on survivors; they are outside this plan.

Add two sentences to the evidence doc section from C2 saying the pass ran, on which commit, and that
it left no broker. Amend the C2 commit or add `docs: a mutation pass over the exit rules leaves no broker`.

### C4. The strict chain on the change

**Why.** The vouched-marks change reached `master` with the full typecheck and the affected specs
run, and not the chain.

1. Read the result of the run that was queued on a commit that includes it:

   ```bash
   gh run view 43155648309 --repo spankyed/apack --json status,conclusion,headSha
   ```

   Report it as it is. If it is still queued or running, say so and go on.
2. Push your app branch and open its PR:

   ```bash
   git push -u origin session/terminal-follow-ups
   gh pr create --base master --title "Terminal follow-ups: the broker at its master, an end-to-end case for vouched marks, and the bash hook on two more versions" --body "<each commit, the check that passed, and what was not run>"
   ```

3. Dispatch the strict chain once, on that branch. The app's CI does not run by itself on a pull
   request, so this run is the gate for the merge:

   ```bash
   gh workflow run ci.yml --repo spankyed/apack --ref session/terminal-follow-ups -f strict_chain=true
   gh run list --repo spankyed/apack --workflow ci.yml --branch session/terminal-follow-ups --limit 1 --json databaseId,url
   ```

   Put the run's URL in the PR body. Then wait for it in one command, in the background (it can take
   over an hour; do not poll it and do not start it twice):

   ```bash
   gh run watch <run-id> --repo spankyed/apack --exit-status
   ```

4. **Merge it yourself when both of these are true:** the local `npm run chain -- --no-native` from B1
   passed on the branch's final commit (run it again if you committed after it), and the strict run
   above ended in success.

   ```bash
   gh pr merge <number> --repo spankyed/apack --merge
   ```

   If the strict run failed: read the failing job (`gh run view <run-id> --repo spankyed/apack --log-failed`).
   A failure in something you changed gets one fix, one push and one new strict run. Anything else, or
   a second failure, is where you stop and report without merging.

Then clean up (below) and send your report.

---

## If an old failure comes back

Two cases failed once each in the past with no proven cause. If either fails while you work, do not
rerun it to make it pass. Capture and report:

- `broker::killing_a_session_takes_the_whole_tree_with_it`: the full failure text, and the output of
  `ps -axo pid,ppid,pgid,sess,stat,etime,command` taken at once.
- A recording-restore case in `tests/keeping.rs` that takes about 20 seconds where it normally takes
  under a second: its name and its full failure text, which says what it was waiting for.

Then run that one case 20 times (`cargo nextest run -E 'test(=<name>)' --stress-count 20` if your
nextest has it, or a shell loop) and report how many failed. Go no further with it.

## Cleaning up

Once both of your pull requests are merged, remove what you made:

```bash
git -C /Users/spankyed/Develop/Projects/apack/apack-terminal worktree remove ../apack-terminal-worktrees.noindex/follow-ups
git -C /Users/spankyed/Develop/Projects/apack/monorepo worktree remove ../monorepo-worktrees.noindex/terminal-follow-ups
```

and your scratch files, your containers by name, and the two images you pulled if nobody else uses
them (`docker image rm bash:5.1 bash:5.3`), and delete your two branches on the remotes
(`git push origin --delete <branch>` in each repository). If you stopped before a merge, leave the
worktrees and branches as they are and list them in your report.
