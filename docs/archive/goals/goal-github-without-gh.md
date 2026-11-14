# GitHub without the GitHub CLI

> **Done 2026-11-13.** All four phases landed: the app signs in to GitHub on its own, calls GitHub's API directly,
> gives git that sign-in on the command, and no longer runs `gh`.
> [`docs/references/git-engine.md`](../../references/git-engine.md#signing-in-to-github) describes the result, and
> Help → "How do I sign in to GitHub?" says it to the user. The Outcome below says what each landed as.

```text
# Goal: the code feature reaches GitHub on its own sign-in, and no longer runs gh

Implement docs/goals/goal-github-without-gh.md. Follow CLAUDE.md and docs/AGENTS.md.
Read Scope, Decisions, Needs from the user and Phases before continuing.
Surveyed at monorepo f4a98378fd; inspect current code first.

Finished when:
- Each phase's Done when holds on current source, and the chain passes.
- Nothing in the repository runs gh, and no setting, help page or prompt names it.
- docs/references/git-engine.md and the help pages describe signing in to GitHub.
- This goal is archived with an Outcome.

Commit each phase as its own checkpoint. Do not expand or reduce scope without the user.
```

## Scope

Today the pull request panel and the sign-in offer run the user's `gh`
(`packages/default-setup/src/features/code/be/services/gh-cli.ts`, 27 calls): `gh pr` and `gh api` for every
pull request read and write, `gh repo view` for the owner and name, `gh auth token` to resolve image links, and
`gh auth setup-git` to give git a sign-in, which writes a credential helper into the user's global git config.
Without `gh` installed and signed in, there are no pull requests and no offer.

The outcome:

1. **Sign in to GitHub in the app** with OAuth's device flow: a code to type at github.com, nothing to paste.
2. **Call GitHub's API directly** for everything `gh-cli.ts` does, over `fetch`.
3. **Git uses that sign-in** for github.com HTTPS remotes, given through the environment of the git the engine
   runs, so the user's git config is never written.
4. **`gh` is gone**: the wrapper, its path resolution, its Settings entry, its help page.

Out of scope: GitHub Enterprise Server and other hosts (GitLab, Bitbucket); SSH remotes, which keep the user's
keys; several GitHub accounts at once; anything in the engine (`apack-git`), which stays host-agnostic: the app
hands it an environment, as it does today.

## Decisions

- **An OAuth App, not a GitHub App.** A GitHub App's user token expires every eight hours and must be refreshed,
  and it reaches only repositories the app was installed on, which a developer opening any folder does not want
  to manage. An OAuth App's token lasts until revoked. Scopes: `repo` (private repositories, pull requests,
  push) and `workflow` (pushing a change to `.github/workflows`, which GitHub refuses without it).
- **The token is a secret in the secrets store**, under the code feature's name, never in settings and never in
  a log (the store's redaction covers it).
- **A pack reads a secret only if it is the pack that wrote it.** `services.secrets` gives packs metadata only
  today, and the code feature is a pack. It gains a caller-bound face — write, read and delete a secret the
  calling pack owns — as `services.settings` is caller-bound. The user's provider keys stay unreadable to
  packs. This is the one host change.
- **Git is given the token on the command, not in its config.** For a github.com HTTPS remote, the app's
  environment for git adds a credential helper through `GIT_CONFIG_COUNT`, which reads the token from an
  environment variable git passes it. A helper named on the command is asked after the user's own, so a user
  whose git already signs in keeps exactly that. Nothing is written to any git config.
- **The owner and name come from the remote's address**, read as `sign-in.ts` already reads a host, not from a
  process.
- **A network call is bounded by progress where it can be and by a listed wait where it cannot.** A request to
  GitHub is a network wait, which CLAUDE.md lists by design; each one takes an abort signal and the
  deadline is declared beside it with that reason.

## Needs from the user

- **An OAuth App registered on GitHub** (Settings, Developer settings, OAuth Apps) with device flow enabled, and
  its client id. A client id is public and is committed; there is no client secret in device flow. Phase 1 cannot
  finish without it, and its specs run against a stand-in until it exists.

## Phases

| # | Deliverable | Done when |
|---|---|---|
| 1 | Pack-owned secrets in `services.secrets`; the device flow in the code feature's backend; Settings shows the signed-in account with Sign out | Against a local stand-in for GitHub's device and token endpoints: the code is shown, polling honours `slow_down` and `expired_token`, the token lands in the store, Sign out removes it; another pack cannot read it. Driven once against github.com |
| 2 | A GitHub client over `fetch` replacing every call in `gh-cli.ts`, REST and GraphQL as each needs; failures named where the panel acts (signed out, missing scope, SSO not authorised for the organisation, not found) | Each panel action runs against a local stand-in serving recorded GitHub responses, dated; the PR panel driven against a real repository, read and write |
| 3 | Git signs in with the token for github.com HTTPS remotes; the panel's offer is "Sign in to GitHub" in place of `gh auth setup-git` | A push to a local smart-HTTP server that requires the token succeeds with it and is refused without it; with a user helper that answers, that helper's answer is the one used; no git config file changes |
| 4 | Remove `gh`: `gh-cli.ts`, `resolveForService('gh')`, the CLI providers entry, `github-token-permissions.md` and every mention | A search of the repository finds no run of `gh`; Settings and help read as written; the chain passes |

## Outcome

**Phase 1** (apack #474): `services.secrets` gained a pack-owned face, `own`, bound to the pack the host admitted; the
code feature signs in with the device flow as the OAuth App `apack` (client id `Ov23lioCOloq0FgG3Uj3`: device flow
on, token expiry off, no client secret) and keeps the token as its own secret. Signing in copies the code and opens
github.com/login/device in the system browser.

**Phase 2**: `github-api.ts` replaces every call `gh-cli.ts` made, GraphQL for reads in the shapes the panel takes
(`GhPullRequest`, `GhPRComment`, `GhReviewThread`), REST for most writes, GraphQL for draft state and resolving a
thread; the owner and name come from the remote's address (`repoOfRemote`). Refusals are `GitHubApiFailure`:
`signed-out`, `not-github`, `missing-scope`, `sso`, `not-found`, `failed`. The panel shows the sign-in in place when
signed out, and asks again when the account changes. `services.cli.gh` is `services.cli.github`.

**Phase 3**: `withGitHubSignIn` gives every git run the sign-in through `GIT_CONFIG_COUNT`, writing no config. Found
on the way: git hands a sign-in that worked to every helper to store, so a keychain helper keeps the app's token
after a push; signing out now runs `git credential reject` for it. The commit panel's offer is to sign in to GitHub.

**Phase 4**: `gh-cli.ts`, `resolveForService('gh')` and the `gh` CLI name, the Settings → Providers entry and
`github-token-permissions.md` are gone; the help article is now how to sign in to GitHub.

**Checked**: against stand-ins for GitHub's device flow, REST and GraphQL APIs, and a smart-HTTP git server that
takes only a token (a push succeeds with the app's, is refused without it, uses the user's own helper first, and no
git config file changes). Driven on 2026-11-13 against github.com in a private scratch repository: signed in,
published a branch, opened pull request #1, read its details, commented, marked it draft and ready, closed it,
deleted the branch, signed out. Typecheck and `npm run chain -- --no-native` pass.

**Left as it was, outside this goal**: the repository's developer tooling still uses `gh` — the release workflows
(`gh release`), `build/release/unrelease.sh`, and the instructions for dispatching CI (`gh workflow run`). None of it
is the app; it runs `gh` on GitHub's runners or a developer's machine.
