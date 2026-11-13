# GitHub without the GitHub CLI

Status: phase 1 built against a stand-in, 2026-11-13; waiting on the OAuth App's client id.

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

## Current handoff

**Phase 1 is built and its specs pass against a stand-in for GitHub.** What is done:

- `services.secrets` has a pack-owned face, `own` (`get`, `set`, `delete`), bound to the pack the host admitted
  (`packages/apack-host/src/packs/service-binding.ts`) and kept in the secrets file beside the user's keys,
  encrypted alike (`secrets/store.ts`, `owned`). Another pack cannot read one: `apack-host`'s
  `tests/secrets/store.spec.ts`.
- The device flow is `services.github` (`code/be/services/github.ts`), over GitHub's endpoints and a wait it is
  handed; the code system's `github` child (`code/be/features/github.ts`) runs it and keeps the token as the
  pack's own secret; the code feature's Settings form shows the code, then the account with Sign out
  (`code/fe/features/github/`).
- Against a stand-in (`tests/features/code/be/_support/github-stand-in.ts`): the code is shown, polling honours
  `slow_down` with and without an interval, `expired_token`, a refusal and a cancel end it, the token lands in the
  store, and Sign out removes it.

**Not done: the drive against github.com.** `GITHUB_CLIENT_ID` is `undefined` until the OAuth App is registered
(Needs from the user), and sign-in says the build has none. Next: set the client id, drive one sign-in against
github.com, then phase 2.
