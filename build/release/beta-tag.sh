#!/bin/bash
# Beta-before-production rule, sourced by release.sh.
#
# Every production version must also exist as a beta, so `apack test --build beta` always
# has a build at least as new as production. If no beta was tagged for the version being
# released, the release also tags v<version>-beta.0 on the same commit; CI builds that tag
# as apack Beta and publishes it as the current beta.

# Prints the beta tag to add for a production release of $1, or nothing if a beta exists.
beta_tag_for_release() {
  local version="$1"
  if [[ "$version" == *-* ]]; then
    return 0
  fi
  # Origin's tags where there is an origin: a beta tag left only in this checkout is no beta anyone can install
  local betas
  if git remote get-url origin > /dev/null 2>&1; then
    betas="$(git ls-remote --tags origin "refs/tags/v${version}-beta.*")" || return 1
  else
    betas="$(git tag -l "v${version}-beta.*")"
  fi
  if [ -n "$betas" ]; then
    return 0
  fi
  echo "v${version}-beta.0"
}
