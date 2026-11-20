#!/usr/bin/env bash
# Tests release.sh and unrelease.sh (build/release) against a scratch repository and a bare origin beside it: what a
# release refuses, that its commit and tags reach origin together or not at all, and that undoing a release takes its
# companion beta tag with it. `gh` is a stub that keeps one file per GitHub release, so nothing here reaches GitHub.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
SCRATCH="$(mktemp -d)"
trap 'rm -rf "$SCRATCH"' EXIT

export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1

ORIGIN="$SCRATCH/origin.git"
WORK="$SCRATCH/work"
RELEASES="$SCRATCH/github-releases"
mkdir -p "$RELEASES" "$SCRATCH/bin"

cat > "$SCRATCH/bin/gh" <<'GH'
#!/usr/bin/env bash
# gh release view <tag> ... | gh release delete <tag> --yes
[ "$1" = release ] || exit 2
case "$2" in
  view) [ -f "$RELEASES/$3" ] && echo "$3" ;;
  delete) rm "$RELEASES/$3" ;;
  *) exit 2 ;;
esac
GH
chmod +x "$SCRATCH/bin/gh"
export RELEASES PATH="$SCRATCH/bin:$PATH"

git init --quiet --bare --initial-branch=master "$ORIGIN"
# Rejects a push to master while the file `reject-master` is there, as a protected or moved branch would
cat > "$ORIGIN/hooks/update" <<'HOOK'
#!/usr/bin/env bash
if [ "$1" = refs/heads/master ] && [ -f "$GIT_DIR/reject-master" ]; then
  echo "master is closed" >&2
  exit 1
fi
HOOK
chmod +x "$ORIGIN/hooks/update"

git clone --quiet "$ORIGIN" "$WORK" 2> /dev/null
cd "$WORK"
git checkout --quiet -B master
mkdir -p build/release
cp "$ROOT"/build/release/*.sh build/release/
cat > package.json <<'JSON'
{
  "name": "scratch",
  "version": "0.4.0",
  "scripts": { "typecheck": "true", "done": "echo '\u2705'" }
}
JSON
cat > package-lock.json <<'JSON'
{
  "name": "scratch",
  "version": "0.4.0",
  "lockfileVersion": 3,
  "requires": true,
  "packages": { "": { "name": "scratch", "version": "0.4.0" } }
}
JSON
printf '# Changelog\n\n## v0.4.0 (2026-01-01)\n\n### Other\n- the first release\n' > CHANGELOG.md
git add -A
git commit --quiet -m "feat: a scratch app"
git push --quiet origin master

failures=0
expect() {
  local description="$1" expected="$2" actual="$3"
  if [ "$actual" = "$expected" ]; then
    echo "ok - $description"
  else
    echo "not ok - $description: expected '$expected', got '$actual'"
    failures=$((failures + 1))
  fi
}
# A command's exit status, its output kept for a failure to be read from
status_of() {
  local status=0
  "$@" > "$SCRATCH/last.log" 2>&1 || status=$?
  echo "$status"
}
release() { status_of bash build/release/release.sh "$@"; }
unrelease() { status_of bash build/release/unrelease.sh "$@" <<< y; }
version() { node -p "require('./package.json').version"; }
origin_tags() { git ls-remote --tags origin | sed 's|.*refs/tags/||' | sort | tr '\n' ' '; }
local_tags() { git tag -l | sort | tr '\n' ' '; }
origin_master() { git ls-remote origin refs/heads/master | cut -f1; }
# The checkout as a refused or failed release has to leave it: this commit, no tag, nothing modified
untouched() { echo "$(git rev-parse HEAD) tags[$(local_tags)] dirty[$(git status --porcelain)] $(version)"; }

START="$(git rev-parse HEAD)"
PRISTINE="$START tags[] dirty[] 0.4.0"

# --- What a release refuses

git checkout --quiet -b side
expect "a release from another branch is refused" "1" "$(release)"
expect "  and leaves the checkout as it was" "$PRISTINE" "$(untouched)"
git checkout --quiet master
git branch --quiet -D side

git commit --quiet --allow-empty -m "fix: not on origin"
expect "a release from a master ahead of origin is refused" "1" "$(release)"
git reset --quiet --hard "$START"

git clone --quiet "$ORIGIN" "$SCRATCH/other"
git -C "$SCRATCH/other" commit --quiet --allow-empty -m "fix: landed meanwhile"
git -C "$SCRATCH/other" push --quiet origin master
expect "a release from a master behind origin is refused" "1" "$(release)"
expect "  and leaves the checkout as it was" "$PRISTINE" "$(untouched)"
git pull --quiet --ff-only origin master
START="$(git rev-parse HEAD)"
PRISTINE="$START tags[] dirty[] 0.4.0"

git tag v0.4.1
expect "a release whose tag exists is refused" "1" "$(release)"
git tag -d v0.4.1 > /dev/null
expect "  before anything is committed" "$PRISTINE" "$(untouched)"

expect "a dry run succeeds" "0" "$(release --dry-run)"
expect "  and names the tags it would push" "  - Tag: v0.4.1   - Tag: v0.4.1-beta.0 " "$(grep -o '  - Tag: v[^ ]*' "$SCRATCH/last.log" | tr '\n' ' ')"
expect "  and leaves the checkout as it was" "$PRISTINE" "$(untouched)"

# --- The push is all or nothing

touch "$ORIGIN/reject-master"
expect "a release whose branch origin rejects fails" "1" "$(release)"
expect "  and no tag of it reaches origin" "" "$(origin_tags)"
expect "  and origin's master stays" "$START" "$(origin_master)"
expect "  and the release commit and its tags are taken back" "$PRISTINE" "$(untouched)"
rm "$ORIGIN/reject-master"

# --- A production release with no beta before it, and undoing it

expect "a release from master at origin's commit goes out" "0" "$(release)"
RELEASE_COMMIT="$(git rev-parse HEAD)"
expect "  as v0.4.1" "chore(release): v0.4.1" "$(git log -1 --format=%s)"
expect "  with its commit on origin's master" "$RELEASE_COMMIT" "$(origin_master)"
expect "  and both its tags on origin" "v0.4.1 v0.4.1-beta.0 " "$(origin_tags)"
expect "  the changelog keeps one header, at its top" "1:# Changelog" "$(grep -n '^.*# Changelog' CHANGELOG.md | tr '\n' ' ' | sed 's/ $//')"
expect "  and the entry that was there, after the new one" "## v0.4.1 ## v0.4.0 " "$(sed -n 's/^\(## v[^ ]*\).*/\1/p' CHANGELOG.md | tr '\n' ' ')"
touch "$RELEASES/v0.4.1" "$RELEASES/v0.4.1-beta.0"

expect "undoing with no version, as a dry run, succeeds" "0" "$(unrelease --dry-run)"
expect "  and names the release by its commit, with both tags" "  2. Push the revert, and delete remote tag: v0.4.1 v0.4.1-beta.0" "$(grep 'delete remote tag' "$SCRATCH/last.log")"
expect "  and changes nothing" "v0.4.1 v0.4.1-beta.0 " "$(origin_tags)"

git checkout --quiet -b side
expect "undoing from another branch is refused" "1" "$(unrelease v0.4.1)"
expect "  with the release's tags still on origin" "v0.4.1 v0.4.1-beta.0 " "$(origin_tags)"
expect "  and its GitHub releases" "v0.4.1 v0.4.1-beta.0" "$(ls "$RELEASES" | tr '\n' ' ' | sed 's/ $//')"
git checkout --quiet master
git branch --quiet -D side

expect "undoing the companion beta tag succeeds" "0" "$(unrelease v0.4.1-beta.0)"
expect "  and no tag of the release is left on origin" "" "$(origin_tags)"
expect "  nor here" "" "$(local_tags)"
expect "  nor a GitHub release" "" "$(ls "$RELEASES")"
expect "  and the version is back" "0.4.0" "$(version)"
expect "  with the revert on origin's master" "$(git rev-parse HEAD)" "$(origin_master)"

# --- A beta release, then its production release: two releases, undone one at a time

expect "a beta release goes out" "0" "$(release --beta)"
expect "  as v0.4.1-beta.0 alone" "v0.4.1-beta.0 " "$(origin_tags)"
expect "the production release after it goes out" "0" "$(release)"
expect "  with its own tag alone added" "v0.4.1 v0.4.1-beta.0 " "$(origin_tags)"
touch "$RELEASES/v0.4.1" "$RELEASES/v0.4.1-beta.0"

expect "undoing with no version succeeds" "0" "$(unrelease)"
expect "  and leaves the earlier beta's tag" "v0.4.1-beta.0 " "$(origin_tags)"
expect "  and its GitHub release" "v0.4.1-beta.0" "$(ls "$RELEASES")"
expect "undoing with no version again succeeds" "0" "$(unrelease)"
expect "  and undoes that beta" "" "$(origin_tags)"
expect "  back to the version before both" "0.4.0" "$(version)"

exit "$failures"
