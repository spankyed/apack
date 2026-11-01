# Untested prefix prototype checkpoint — 2026-10-31

This checkpoint preserves work before the user-requested rebase onto current master.
It is not a qualification or accepted semantic change. No recipe here has been run.

The prototype combines literal completion with existing bounded exact whole-word typo
alternatives on the final prefix term; only the literal receives a wildcard. The existing
prefix typo assertion changes to require its results, with a fuzzy:false opt-out assertion.
Four shared judgments were independently preregistered at 66e8531079 and remain unchanged.
The production remains elmdb; this work is only the SQLite candidate.

Private recipes plan a pinned native shared-gold control, the expected two SQLite
pre-fix failures, cache-disabled static checks, ordinary package builds, SQLite contracts,
and the existing growth diagnostic plus four explicitly added prefix cases. Their frozen
input hashes, source revision and container assumptions refer to the pre-rebase source.
Reconcile them with the new integration before execution; do not run them blindly after
rebasing or equate a recorded recipe with an executed test. All original acceptance
criteria, timeouts, search-work and performance budgets remain required.
