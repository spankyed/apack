#!/bin/bash

# Release script for apack
# Usage: npm run release [patch|minor|major] [--dry-run] [--beta]
#
# Version flow:
#   0.3.14  + minor --beta  → 0.4.0-beta.0   (start beta cycle for next minor)
#   0.4.0-beta.0  + --beta  → 0.4.0-beta.1   (iterate beta)
#   0.4.0-beta.1  (no flag) → 0.4.0           (promote to release)
#   0.4.0         (no flag) → 0.4.1           (normal release)
#
# Tags are always v${VERSION}: v0.4.0-beta.0, v0.4.0, etc.
#
# A release is cut from master at origin's commit, and its commit and tags reach origin in one atomic push: either
# all of them land or none does, so CI never builds a tag whose commit isn't on master. A release that fails after
# its commit is made takes the commit and its tags back, and leaves the checkout as it found it.

set -e

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR/../.."
source "$SCRIPT_DIR/beta-tag.sh"

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
BLUE='\033[0;34m'
YELLOW='\033[0;33m'
NC='\033[0m'

# Parse arguments
BUMP_TYPE="patch"
DRY_RUN=false
IS_BETA=false
RELEASE_BRANCH="master"

for arg in "$@"; do
  case "$arg" in
    patch|minor|major) BUMP_TYPE="$arg" ;;
    --dry-run) DRY_RUN=true ;;
    --beta) IS_BETA=true ;;
    *) echo -e "${RED}Unknown argument: $arg${NC}"; echo "Usage: release.sh [patch|minor|major] [--dry-run] [--beta]"; exit 1 ;;
  esac
done

CURRENT_VERSION=$(node -p "require('./package.json').version")
CURRENT_IS_PRERELEASE=false
if [[ "$CURRENT_VERSION" == *-* ]]; then
  CURRENT_IS_PRERELEASE=true
fi

CHANNEL_LABEL=""
if [ "$IS_BETA" = true ]; then
  CHANNEL_LABEL=" (Beta)"
fi

echo "=========================================="
echo "🚀 apack Release${CHANNEL_LABEL}"
echo "=========================================="
echo ""

# Step 1: Ensure clean working tree
echo -e "${BLUE}[1/5]${NC} Checking working tree..."
if [ -n "$(git status --porcelain)" ]; then
  echo -e "${RED}✗ Working tree is dirty. Commit or stash changes first.${NC}"
  git status --short
  exit 1
fi
echo -e "${GREEN}✓${NC} Working tree clean"
BRANCH="$(git symbolic-ref --quiet --short HEAD || true)"
if [ "$BRANCH" != "$RELEASE_BRANCH" ]; then
  echo -e "${RED}✗ A release is cut from ${RELEASE_BRANCH}, and this checkout is on ${BRANCH:-a detached HEAD}.${NC}"
  exit 1
fi
# The beta-before-production rule reads existing beta tags
git fetch --tags --quiet origin
START_COMMIT="$(git rev-parse HEAD)"
if [ "$START_COMMIT" != "$(git rev-parse --quiet --verify "refs/remotes/origin/${RELEASE_BRANCH}")" ]; then
  echo -e "${RED}✗ ${RELEASE_BRANCH} is not at origin/${RELEASE_BRANCH}. Pull what origin has, and push or drop what it doesn't.${NC}"
  git status --short --branch | head -1
  exit 1
fi
echo -e "${GREEN}✓${NC} On ${RELEASE_BRANCH}, at origin's commit"
echo ""

# Step 2: Run typecheck
echo -e "${BLUE}[2/5]${NC} Running type checks..."
npm run typecheck
echo -e "${GREEN}✓${NC} Type checks passed"
echo ""

# Step 3: Bump version
echo -e "${BLUE}[3/5]${NC} Bumping version..."
# From here the script edits the three files the release commit holds. Any exit before the release is pushed that
# leaves them edited with no commit made, an interrupt among them, puts them back
RELEASE_PUSHED=false
restore_on_exit() {
  if [ "$RELEASE_PUSHED" != true ] && [ "$(git rev-parse HEAD)" = "$START_COMMIT" ]; then
    git restore --source="$START_COMMIT" --staged --worktree -- package.json package-lock.json CHANGELOG.md 2> /dev/null || true
  fi
}
trap restore_on_exit EXIT

if [ "$IS_BETA" = true ]; then
  if [ "$CURRENT_IS_PRERELEASE" = true ]; then
    # Already in a beta cycle — iterate: 0.4.0-beta.0 → 0.4.0-beta.1
    npm version prerelease --preid=beta --no-git-tag-version > /dev/null 2>&1
  else
    # Start a new beta cycle: 0.3.14 → 0.4.0-beta.0 (for minor)
    npm version "pre${BUMP_TYPE}" --preid=beta --no-git-tag-version > /dev/null 2>&1
  fi
else
  if [ "$CURRENT_IS_PRERELEASE" = true ]; then
    # Promote prerelease to release: 0.4.0-beta.1 → 0.4.0
    npm version "$BUMP_TYPE" --no-git-tag-version > /dev/null 2>&1
  else
    # Normal release: 0.4.0 → 0.4.1
    npm version "$BUMP_TYPE" --no-git-tag-version > /dev/null 2>&1
  fi
fi

NEW_VERSION=$(node -p "require('./package.json').version")
TAG_NAME="v${NEW_VERSION}"
BETA_TAG_NAME="$(beta_tag_for_release "$NEW_VERSION")"

echo "  $CURRENT_VERSION → $NEW_VERSION"
# Read before anything is committed: a tag that exists would fail `git tag` after the release commit was made
for tag in "$TAG_NAME" $BETA_TAG_NAME; do
  if git rev-parse --quiet --verify "refs/tags/${tag}" > /dev/null; then
    git checkout --quiet -- package.json package-lock.json
    echo -e "${RED}✗ Tag ${tag} already exists. Undo that release first (npm run unrelease ${tag}), or delete a tag origin doesn't have.${NC}"
    exit 1
  fi
done
if [ -n "$BETA_TAG_NAME" ]; then
  echo "  No beta was released for $NEW_VERSION: also tagging $BETA_TAG_NAME so this build is published as the current beta"
fi

if [ "$DRY_RUN" = true ]; then
  # Take the version bump back from the commit, which the clean tree above makes safe: `npm version` back to the old
  # version would keep its own rewriting of package.json, such as a \u escape written out as its character
  git checkout --quiet -- package.json package-lock.json
  echo ""
  echo -e "${YELLOW}[DRY RUN] Would create:${NC}"
  echo "  - Version bump: $CURRENT_VERSION → $NEW_VERSION"
  echo "  - Commit: chore(release): ${TAG_NAME}"
  echo "  - Tag: ${TAG_NAME}"
  if [ -n "$BETA_TAG_NAME" ]; then
    echo "  - Tag: ${BETA_TAG_NAME} (no beta for ${NEW_VERSION} yet; CI publishes this build as the current beta)"
  fi
  echo "  - Push to origin, the commit and its tags together (triggers CI build)"
  echo ""
  echo -e "${YELLOW}Run without --dry-run to execute.${NC}"
  exit 0
fi

echo -e "${GREEN}✓${NC} Version bumped"
echo ""

# Step 4: Generate changelog
echo -e "${BLUE}[4/5]${NC} Generating changelog..."

# Find the most recent tag (any channel)
LAST_TAG=$(git describe --tags --abbrev=0 2>/dev/null || echo "")
if [ -n "$LAST_TAG" ]; then
  RANGE="$LAST_TAG..HEAD"
else
  RANGE="HEAD"
fi

# Build changelog entry from conventional commits
CHANGELOG_ENTRY="## ${TAG_NAME} ($(date +%Y-%m-%d))"$'\n'

# Group commits by type
FEATURES=$(git log "$RANGE" --oneline --grep="^feat" --format="- %s" 2>/dev/null | sed 's/^- feat[:(]/- /' | sed 's/^- )/- /')
FIXES=$(git log "$RANGE" --oneline --grep="^fix" --format="- %s" 2>/dev/null | sed 's/^- fix[:(]/- /' | sed 's/^- )/- /')
REFACTORS=$(git log "$RANGE" --oneline --grep="^refactor" --format="- %s" 2>/dev/null | sed 's/^- refactor[:(]/- /' | sed 's/^- )/- /')
OTHER=$(git log "$RANGE" --oneline --format="%s" 2>/dev/null | grep -v "^feat" | grep -v "^fix" | grep -v "^refactor" | grep -v "^chore(release)" | sed 's/^/- /')

if [ -n "$FEATURES" ]; then
  CHANGELOG_ENTRY+=$'\n'"### Features"$'\n'"$FEATURES"$'\n'
fi
if [ -n "$FIXES" ]; then
  CHANGELOG_ENTRY+=$'\n'"### Fixes"$'\n'"$FIXES"$'\n'
fi
if [ -n "$REFACTORS" ]; then
  CHANGELOG_ENTRY+=$'\n'"### Refactors"$'\n'"$REFACTORS"$'\n'
fi
if [ -n "$OTHER" ]; then
  CHANGELOG_ENTRY+=$'\n'"### Other"$'\n'"$OTHER"$'\n'
fi

# Prepend to CHANGELOG.md, under its one header. printf writes a commit subject as it is, where `echo -e` would read
# its backslashes as escapes
if [ -f "CHANGELOG.md" ]; then
  EXISTING=$(cat CHANGELOG.md)
  EXISTING="${EXISTING#"# Changelog"}"
  # The blank lines that followed the header
  EXISTING="${EXISTING#"${EXISTING%%[!$'\n']*}"}"
  printf '# Changelog\n\n%s\n%s\n' "$CHANGELOG_ENTRY" "$EXISTING" > CHANGELOG.md
else
  printf '# Changelog\n\n%s' "$CHANGELOG_ENTRY" > CHANGELOG.md
fi

echo -e "${GREEN}✓${NC} Changelog updated"
echo ""

# Step 5: Commit, tag, and push
echo -e "${BLUE}[5/5]${NC} Creating release commit and tag..."

# Takes back the release commit and its tags, so a release that didn't reach origin leaves nothing a second attempt
# would trip over. Only the three files the release commit holds are restored.
undo_local_release() {
  git tag -d "$TAG_NAME" ${BETA_TAG_NAME:+"$BETA_TAG_NAME"} > /dev/null 2>&1 || true
  git reset --quiet --soft "$START_COMMIT"
  git restore --source="$START_COMMIT" --staged --worktree -- package.json package-lock.json CHANGELOG.md
}

git add package.json package-lock.json CHANGELOG.md
if ! git commit -m "chore(release): ${TAG_NAME}"; then
  undo_local_release
  echo -e "${RED}✗ The release commit failed. Nothing was released.${NC}"
  exit 1
fi
for tag in "$TAG_NAME" $BETA_TAG_NAME; do
  if ! git tag "$tag"; then
    undo_local_release
    echo -e "${RED}✗ Tag ${tag} could not be created. Nothing was released.${NC}"
    exit 1
  fi
done

echo ""
echo -e "  Pushing to origin..."
# --atomic: origin takes the branch and every tag, or none of them. Pushed apart, a branch origin rejects would still
# leave the tags there, and CI builds a release from each tag it sees
if ! git push --atomic origin "HEAD:refs/heads/${RELEASE_BRANCH}" "refs/tags/${TAG_NAME}" ${BETA_TAG_NAME:+"refs/tags/${BETA_TAG_NAME}"}; then
  undo_local_release
  echo -e "${RED}✗ origin rejected the push, so nothing was released: the release commit and its tags are taken back.${NC}"
  exit 1
fi

RELEASE_PUSHED=true
echo -e "${GREEN}✓${NC} Release ${TAG_NAME} pushed"
echo ""

echo "=========================================="
echo "✅ Release ${TAG_NAME} Complete!"
echo "=========================================="
echo ""
echo "📦 CI will build, sign, and publish the release automatically."
echo "   Check: https://github.com/spankyed/apack/actions"
echo ""
echo "📋 View at: https://github.com/spankyed/apack/releases"
echo ""
