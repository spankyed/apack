# Shared by the two halves of the packaged-authoring check: phase timing, and the environment an outside
# pack author actually has.
#
# A library rather than one script with a mode, for the reason `test-external-pack-contract.sh` gives:
# `check:tiers` reads a step's scripts as text to find out whether it can reach the app, and a branch it
# never takes still reads as a reach. So the half that needs no app is its own file, and nothing in here
# mentions the app either.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

# Where the author half tells the app half what it built. Repo-relative because that is the only thing the
# chain can derive an edge from (`dependsOn` reads one step's `outputs` against another's `inputs`), and
# **the work dir itself stays outside the checkout**: a pack built inside it would resolve `@apackdev/*` by
# walking up to the workspace `node_modules`, which is the one thing this check exists to prove does not
# happen. So the handoff is a path and a digest in the tree, and the tree the pack lives in is not.
HANDOFF="$ROOT/tests/authoring-handoff"

# Every phase goes through here, so this is the one place that can say where the time went. This script
# is the tail of the chain's critical path (`packages:ensure -> compile -> build:runtime -> this`), and it
# had no timing of its own — the step's total was the only number anyone had.
step() {
  _step_report
  _step_name="$*"; _step_at=$SECONDS
  printf '\n==> %s\n' "$*"
}
_step_report() {
  [ -n "${_step_name:-}" ] && printf '    [%3ss] %s\n' "$((SECONDS - _step_at))" "$_step_name"
  return 0
}
fail() { echo "FAIL: $*" >&2; exit 1; }

unset APACK_HOST_ROOT APACK_HOST APACK_APP APACK_BUILD APACK_CHANNEL APACK_HOST_EXECUTABLE APACK_CLI
# The CLI caches its Beta downloads under the user's home; use a fresh one.
#
# TWO NON-HERMETIC INPUTS. Everything else this script reads is in the checkout or in $WORK: HOME is a
# fresh directory, the @apackdev packages come from tarballs it packs itself, and the app choice is written
# below rather than typed.
#
# npm's cache is deliberately not isolated, because a cold cache makes this a network test — several minutes
# of downloads, and a failure when the network is down that says nothing about the code. The cost of keeping
# it is that a corrupt or partial cache entry fails here and nowhere else; `npm cache verify` is the first
# thing to try when this script fails on an install and no other step does.
#
# Nor is the CLI's compiler store (`compilerStoreRoot`, packages/apack-cli/src/build/compiler-installation.ts),
# which lives under HOME's caches and so would move with it: a store per run copies the compiler runtime again
# every run, a few hundred MB of read-only files, and macOS security-assesses every new copy's executables, which
# is the cost the store is shared to pay once. It is resolved as the CLI resolves it, before HOME moves, and an
# APACK_COMPILER_STORE already set is kept. A compiler change still captures a new entry here, so the capture
# this check exercises is the one a change to the compiler makes.
# Each half sets these once it knows its work dir, through `useWorkDir` below, and claims the dir for its run.
useWorkDir() {
  export npm_config_cache="$(npm config get cache)"
  APACK_COMPILER_STORE="${APACK_COMPILER_STORE:-$(cd "$ROOT/packages/apack-cli" && node --input-type=module -e '
    import envPaths from "env-paths";
    import path from "node:path";
    process.stdout.write(path.join(envPaths("apack-cli", { suffix: "" }).cache, "compilers"));
  ')}"
  export APACK_COMPILER_STORE
  export HOME="$1/home"
  mkdir -p "$HOME"
  echo "$$" > "$1/owner"
}

# One work dir per checkout, named by the checkout's canonical path, so a run replaces the last rather than
# adding to it: `apack-authoring-<sha256 of the path>` in the temp dir, holding `checkout` (the path) and
# `owner` (the pid of the run using it). The chain serializes a checkout's author and app halves; a run
# started by hand beside one refuses while its owner is live, rather than removing a dir in use. A dir whose
# checkout no longer exists (a removed worktree) is swept once its owner is gone. Removing a dir makes its
# directories writable first, since a work dir can hold read-only ones (a compiler store the run made under its
# HOME when APACK_COMPILER_STORE pointed there, a package that ships them), and a dir that still can't be
# removed is named on stderr: the sweep carries on, and replacing this checkout's own refuses.
newWorkDir() {
  node -e '
    const fs = require("node:fs"), os = require("node:os"), path = require("node:path"), crypto = require("node:crypto");
    const [root, self] = process.argv.slice(1);
    const checkout = fs.realpathSync(root);
    const name = "apack-authoring-" + crypto.createHash("sha256").update(checkout).digest("hex");
    const live = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; } };
    const ownedLive = (dir) => {
      let pid = NaN;
      try { pid = Number(fs.readFileSync(path.join(dir, "owner"), "utf8").trim()); } catch {}
      return Number.isSafeInteger(pid) && pid > 0 && pid !== Number(self) && live(pid) ? pid : 0;
    };
    const writable = (at) => {
      fs.chmodSync(at, 0o700);
      for (const entry of fs.readdirSync(at, { withFileTypes: true })) {
        if (entry.isDirectory()) writable(path.join(at, entry.name));
      }
    };
    const remove = (dir) => {
      try { writable(dir); fs.rmSync(dir, { recursive: true, force: true }); return true; }
      catch (error) { process.stderr.write(`authoring: could not remove the work dir ${dir}: ${error.message}\n`); return false; }
    };
    const isDirectory = (dir) => { try { return fs.lstatSync(dir).isDirectory(); } catch { return false; } };
    // Other checkouts: only a dir that names a checkout which no longer exists, and no live owner
    for (const entry of fs.readdirSync(os.tmpdir())) {
      if (entry === name || !/^apack-authoring-[0-9a-f]{64}$/.test(entry)) continue;
      const dir = path.join(os.tmpdir(), entry);
      if (!isDirectory(dir)) continue;
      let of;
      try { of = fs.readFileSync(path.join(dir, "checkout"), "utf8"); } catch { continue; }
      if (fs.existsSync(of) || ownedLive(dir)) continue;
      remove(dir);
    }
    const dir = path.join(os.tmpdir(), name);
    if (fs.existsSync(dir) || isDirectory(dir)) {
      if (!isDirectory(dir)) { process.stderr.write(`authoring: ${dir} is not a directory; remove it\n`); process.exit(1); }
      const owner = ownedLive(dir);
      if (owner) {
        process.stderr.write(`authoring: another packaged-authoring run of this checkout (pid ${owner}) is using ${dir}\n`);
        process.exit(1);
      }
      if (!remove(dir)) process.exit(1);
    }
    fs.mkdirSync(dir, { mode: 0o700 });
    fs.writeFileSync(path.join(dir, "checkout"), checkout);
    fs.writeFileSync(path.join(dir, "owner"), String(self));
    process.stdout.write(dir);
  ' "$ROOT" "$$"
}

# Required file outputs expose loss of external work and changed archive bytes to the
# chain without walking node_modules. Publish only after authoring succeeds.
writeAuthoringHandoff() {
  mkdir -p "$HANDOFF"
  node -e '
    const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
    const [work, archive, pack, out] = process.argv.slice(1);
    const sha = crypto.createHash("sha256").update(fs.readFileSync(archive)).digest("hex");
    const ready = path.join(work, "authoring-ready");
    fs.writeFileSync(ready, "ready\n");
    fs.symlinkSync(ready, path.join(out, "work-ready"));
    fs.symlinkSync(archive, path.join(out, "archive"));
    fs.writeFileSync(path.join(out, "work.json"), JSON.stringify({ work, archive, pack, sha }, null, 2) + "\n");
  ' "$WORK" "$ARCHIVE" "$PACK" "$HANDOFF"
}
