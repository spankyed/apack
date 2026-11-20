#!/bin/bash

# Undo a release for apack
# Usage: npm run unrelease [version] [--dry-run]
#
# Reverses what release.sh does, from master at origin's commit, as a release is cut:
# 1. Reverts the release commit
# 2. Pushes the revert and the tags' deletion to origin together, so origin takes both or neither
# 3. Deletes the GitHub release (if it exists)
# 4. Deletes the local git tag
#
# Nothing on origin or GitHub changes before the revert is made and pushed: a revert that conflicts, or a push origin
# rejects, leaves the release as it was. What can't be read (origin's tags, GitHub's releases) stops it, rather than
# counting as not there.
#
# A production release that had no beta is two tags on one commit: v<version>, and the companion v<version>-beta.0
# that release.sh adds for the beta-before-production rule (beta-tag.sh), each with a GitHub release of its own. They
# are one release and are undone together, whichever of the two is named. With no version, the release undone is the
# newest release commit in this branch's history that still has its tag: the commit's message names it, where
# `git describe` would pick either of two tags on one commit.

set -e

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR/../.."

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
BLUE='\033[0;34m'
YELLOW='\033[0;33m'
NC='\033[0m'

# Parse arguments
VERSION=""
DRY_RUN=false

for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=true ;;
    v*) VERSION="$arg" ;;
    [0-9]*) VERSION="v$arg" ;;
    *) echo -e "${RED}Unknown argument: $arg${NC}"; echo "Usage: unrelease.sh [version] [--dry-run]"; exit 1 ;;
  esac
done

# The commit release.sh made for a tag, or nothing
release_commit_for() {
  git log --all --fixed-strings --grep="chore(release): $1" --format="%H %s" | awk -v subject="chore(release): $1" '
    { hash = $1; sub(/^[^ ]+ /, "") }
    $0 == subject { print hash; exit }'
}

RELEASE_BRANCH="master"
BRANCH="$(git symbolic-ref --quiet --short HEAD || true)"
if [ "$BRANCH" != "$RELEASE_BRANCH" ]; then
  echo -e "${RED}✗ A release is undone from ${RELEASE_BRANCH}, and this checkout is on ${BRANCH:-a detached HEAD}.${NC}"
  exit 1
fi
# The newest release and its tags are read from origin's, not from what this checkout last fetched
git fetch --tags --quiet origin
if [ "$(git rev-parse HEAD)" != "$(git rev-parse --quiet --verify "refs/remotes/origin/${RELEASE_BRANCH}")" ]; then
  echo -e "${RED}✗ ${RELEASE_BRANCH} is not at origin/${RELEASE_BRANCH}. Pull what origin has, and push or drop what it doesn't.${NC}"
  exit 1
fi

if [ -z "$VERSION" ]; then
  while read -r candidate; do
    if [ -n "$(git tag -l "$candidate")" ]; then
      VERSION="$candidate"
      break
    fi
  done < <(git log --grep='^chore(release): v' --format='%s' | sed -n 's/^chore(release): \(v[^ ]*\)$/\1/p')
  if [ -z "$VERSION" ]; then
    echo -e "${RED}✗ No release with a tag found in this branch's history, and no version specified.${NC}"
    exit 1
  fi
fi

# A companion beta tag names no release commit of its own: it is undone as the production release it was tagged with
if [ -z "$(release_commit_for "$VERSION")" ] && [[ "$VERSION" == *-beta.0 ]] && [ -n "$(release_commit_for "${VERSION%-beta.0}")" ]; then
  echo "$VERSION is the companion beta tag of ${VERSION%-beta.0}: undoing both"
  VERSION="${VERSION%-beta.0}"
fi

echo "=========================================="
echo "⏪ apack Undo Release: $VERSION"
echo "=========================================="
echo ""

# Ensure clean working tree
if [ -n "$(git status --porcelain)" ]; then
  echo -e "${RED}✗ Working tree is dirty. Commit or stash changes first.${NC}"
  git status --short
  exit 1
fi

# Find the release commit
RELEASE_COMMIT=$(release_commit_for "$VERSION")

if [ -z "$RELEASE_COMMIT" ]; then
  echo -e "${RED}✗ Could not find release commit for $VERSION${NC}"
  echo "  Expected commit message: chore(release): $VERSION"
  exit 1
fi

RELEASE_COMMIT_SHORT=$(echo "$RELEASE_COMMIT" | cut -c1-8)

# What a tag names on origin, or nothing. A listing origin doesn't answer ends the script
remote_tag_commit() {
  local listed
  listed="$(git ls-remote --tags origin "refs/tags/$1")" || { echo -e "${RED}✗ origin's tags couldn't be read.${NC}" >&2; exit 1; }
  echo "$listed" | head -1 | cut -f1
}

# Whether GitHub has a release for a tag. Only gh's `release not found` is none: any other failure ends the script
gh_release_exists() {
  local err
  if err="$(gh release view "$1" --json tagName --jq '.tagName' 2>&1 > /dev/null)"; then return 0; fi
  if [[ "$err" == *"release not found"* ]]; then return 1; fi
  echo -e "${RED}✗ GitHub's release for $1 couldn't be read: ${err}${NC}" >&2
  exit 1
}

if ! command -v gh &> /dev/null; then
  echo -e "${RED}✗ gh is not installed, so the GitHub release can't be read or deleted.${NC}"
  exit 1
fi

# The release's tags: its own, and the companion beta tag when one sits on the same commit. A v<version>-beta.0 on
# another commit is an earlier beta release, which this one didn't make and doesn't undo
TAGS=("$VERSION")
if [[ "$VERSION" != *-* ]]; then
  COMPANION="${VERSION}-beta.0"
  if [ "$(git rev-parse --quiet --verify "refs/tags/${COMPANION}^{commit}" || true)" = "$RELEASE_COMMIT" ] \
    || [ "$(remote_tag_commit "$COMPANION")" = "$RELEASE_COMMIT" ]; then
    TAGS+=("$COMPANION")
  fi
fi

LOCAL_TAGS=()
REMOTE_TAGS=()
GH_RELEASES=()
for tag in "${TAGS[@]}"; do
  if [ -n "$(git tag -l "$tag")" ]; then LOCAL_TAGS+=("$tag"); fi
  remote_commit="$(remote_tag_commit "$tag")"
  if [ -n "$remote_commit" ]; then REMOTE_TAGS+=("$tag"); fi
  if gh_release_exists "$tag"; then GH_RELEASES+=("$tag"); fi
done

# Show what will happen
echo -e "${BLUE}Actions:${NC}"
echo "  1. Revert commit: $RELEASE_COMMIT_SHORT (chore(release): $VERSION)"
echo "  2. Push the revert, and delete remote tag: ${REMOTE_TAGS[*]:-(not found, skipping)}"
echo "  3. Delete GitHub release: ${GH_RELEASES[*]:-(not found, skipping)}"
echo "  4. Delete local tag: ${LOCAL_TAGS[*]:-(not found, skipping)}"
echo ""

if [ "$DRY_RUN" = true ]; then
  echo -e "${YELLOW}[DRY RUN] No changes made.${NC}"
  exit 0
fi

# Confirm
echo -ne "${YELLOW}Proceed? [y/N] ${NC}"
read -r CONFIRM
if [ "$CONFIRM" != "y" ] && [ "$CONFIRM" != "Y" ]; then
  echo "Aborted."
  exit 0
fi
echo ""

# Step 1: Revert the release commit
echo -e "${BLUE}[1/4]${NC} Reverting release commit..."
if ! git revert "$RELEASE_COMMIT" --no-edit; then
  git revert --abort > /dev/null 2>&1 || true
  echo -e "${RED}✗ The release commit doesn't revert cleanly. Nothing was undone.${NC}"
  exit 1
fi
echo -e "${GREEN}✓${NC} Release commit reverted"

# Step 2: Push the revert and the tags' deletion together
echo -e "${BLUE}[2/4]${NC} Pushing the revert and deleting remote tag..."
DELETIONS=()
for tag in "${REMOTE_TAGS[@]+"${REMOTE_TAGS[@]}"}"; do DELETIONS+=(":refs/tags/${tag}"); done
if ! git push --atomic origin "HEAD:refs/heads/${RELEASE_BRANCH}" "${DELETIONS[@]+"${DELETIONS[@]}"}"; then
  git reset --quiet --hard "HEAD~1"
  echo -e "${RED}✗ origin rejected the push, so nothing was undone: the revert is taken back.${NC}"
  exit 1
fi
echo -e "${GREEN}✓${NC} Pushed; remote tag deleted: ${REMOTE_TAGS[*]:-(none)}"

# Step 3: Delete GitHub release
if [ "${#GH_RELEASES[@]}" -gt 0 ]; then
  echo -e "${BLUE}[3/4]${NC} Deleting GitHub release..."
  for tag in "${GH_RELEASES[@]}"; do
    gh release delete "$tag" --yes
  done
  echo -e "${GREEN}✓${NC} GitHub release deleted: ${GH_RELEASES[*]}"
else
  echo -e "${BLUE}[3/4]${NC} GitHub release not found, skipping"
fi

# Step 4: Delete local tag
if [ "${#LOCAL_TAGS[@]}" -gt 0 ]; then
  echo -e "${BLUE}[4/4]${NC} Deleting local tag..."
  git tag -d "${LOCAL_TAGS[@]}"
  echo -e "${GREEN}✓${NC} Local tag deleted: ${LOCAL_TAGS[*]}"
else
  echo -e "${BLUE}[4/4]${NC} Local tag not found, skipping"
fi

echo ""
echo "=========================================="
echo "✅ Release $VERSION undone!"
echo "=========================================="
echo ""

# Show final state
CURRENT_VERSION=$(node -p "require('./package.json').version")
echo "  Version: $CURRENT_VERSION"
echo "  Tags:    $(git tag -l | sort -V | tr '\n' ' ')"
echo ""
