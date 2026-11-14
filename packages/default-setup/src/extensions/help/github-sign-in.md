---
features: [code]
order: 3
---
# How do I sign in to GitHub?

apack signs in to GitHub on its own, as the OAuth app **apack**. Nothing else needs installing, and your git settings are not changed.

**To sign in:** open Settings → Code → GitHub and choose **Sign in to GitHub**. apack copies a short code and opens github.com/login/device in your browser: paste the code there and approve apack. Settings then shows the account you signed in as. The pull request panel and the offer to sign in after a refused push do the same.

**What it is used for:**
- **Pull requests** — the pull request panel lists, opens, creates, merges and comments on the pull requests of a repository whose remote is on github.com.
- **Pushing and pulling over HTTPS** — git uses the sign-in for github.com remotes it has no sign-in of its own for. It is handed to git for each command and never written to a git config. If your git already signs in to GitHub, through a credential helper or SSH, that sign-in is the one used.

**The access it asks for:** `repo` (your repositories and their pull requests, private ones included) and `workflow` (pushing a change to a repository's `.github/workflows`).

**If the panel says the sign-in lacks access to a repository:**
- **An organisation that uses single sign-on** must have apack authorised for it: on github.com, under Settings → Applications → Authorized OAuth Apps → apack, grant access for that organisation.
- **An organisation that restricts OAuth apps** must approve apack. An owner of the organisation can, or you can request it from the same page.
- **A repository GitHub says it cannot find** is one the account you signed in as cannot see.

**To sign out:** choose **Sign out** in Settings → Code → GitHub. apack forgets the sign-in on this machine and has git forget it too. The sign-in stays valid at GitHub until you revoke it there, under Settings → Applications → Authorized OAuth Apps.
