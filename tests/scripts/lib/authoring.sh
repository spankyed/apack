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
# THE ONE NON-HERMETIC INPUT. Everything else this script reads is in the checkout or in $WORK: HOME is a
# fresh directory, the @apackdev packages come from tarballs it packs itself, and the app choice is written
# below rather than typed. npm's cache is deliberately not isolated, because a cold cache makes this a
# network test — several minutes of downloads, and a failure when the network is down that says nothing
# about the code. The cost of keeping it is that a corrupt or partial cache entry fails here and nowhere
# else; `npm cache verify` is the first thing to try when this script fails on an install and no other
# step does.
# Each half sets this once it knows its work dir, through `useWorkDir` below.
useWorkDir() {
  export npm_config_cache="$(npm config get cache)"
  export HOME="$1/home"
  mkdir -p "$HOME"
}

# Sweep only this canonical checkout's dead owners. A live (possibly reused) PID is
# preserved conservatively. The caller must serialize this checkout's author/app halves.
# A work dir holds read-only directories (the CLI's compiler store under its HOME), whose
# entries can't be unlinked until they are writable again, so each directory is made
# writable before the removal; a work dir that still can't be removed is named on stderr.
newWorkDir() {
  local prefix
  prefix="$(node -e '
    const fs = require("node:fs"), os = require("node:os"), path = require("node:path"), crypto = require("node:crypto");
    const prefix = "apack-authoring-" + crypto.createHash("sha256").update(fs.realpathSync(process.argv[1])).digest("hex") + "-";
    const live = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; } };
    for (const name of fs.readdirSync(os.tmpdir())) {
      if (!name.startsWith(prefix)) continue;
      const pid = Number(/^(\d+)-[A-Za-z0-9]{6}$/.exec(name.slice(prefix.length))?.[1]);
      if (!Number.isSafeInteger(pid) || pid <= 0 || live(pid)) continue;
      const directory = path.join(os.tmpdir(), name);
      // Only ordinary directories belong to this sweep; links and files are preserved.
      let isDirectory = false;
      try { isDirectory = fs.lstatSync(directory).isDirectory(); } catch {}
      if (!isDirectory) continue;
      const writable = (at) => {
        fs.chmodSync(at, 0o700);
        for (const entry of fs.readdirSync(at, { withFileTypes: true })) {
          if (entry.isDirectory()) writable(path.join(at, entry.name));
        }
      };
      try {
        writable(directory);
        fs.rmSync(directory, { recursive: true, force: true });
      } catch (error) {
        process.stderr.write(`authoring: could not remove the dead work dir ${directory}: ${error.message}\n`);
      }
    }
    process.stdout.write(prefix);
  ' "$ROOT")"
  mktemp -d "${TMPDIR:-/tmp}/${prefix}$$-XXXXXX"
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
