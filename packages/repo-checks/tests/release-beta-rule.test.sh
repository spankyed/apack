#!/usr/bin/env bash
# Tests the beta-before-production rule (build/release/beta-tag.sh) in a scratch git repo.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
source "$ROOT/build/release/beta-tag.sh"

REPO="$(mktemp -d)"
trap 'rm -rf "$REPO"' EXIT
cd "$REPO"
git init --quiet
git -c user.name=t -c user.email=t@t commit --quiet --allow-empty -m init

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

expect "production release without a beta also tags beta.0" "v0.4.0-beta.0" "$(beta_tag_for_release 0.4.0)"

git tag v0.4.0-beta.2
expect "production release after a beta adds no tag" "" "$(beta_tag_for_release 0.4.0)"

git tag v0.4.1-rc.1
expect "other prerelease tags don't count as a beta" "v0.4.1-beta.0" "$(beta_tag_for_release 0.4.1)"

expect "a beta release itself adds no tag" "" "$(beta_tag_for_release 0.4.2-beta.0)"

git tag v0.4.10-beta.0
expect "a beta for another version with the same prefix doesn't count" "v0.4.1-beta.0" "$(beta_tag_for_release 0.4.1)"

exit "$failures"
