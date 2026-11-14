# AgentBuddy Film Action Moments

The film must show apparent product action, not static UI posing. `npm run audit:film-action --workspace @app/video` verifies these frame-driven moments from `film/state/*`.

| Area | Verified Motion |
| --- | --- |
| Notes | Three note lines reveal over time with caret state. |
| Chat | User prompt types in, assistant response streams, tool rows reveal, tool block completes. |
| Threads board | A task card moves horizontally, vertically, and rotates between columns. |
| Code | Diff lines reveal, commit message appears, source-control switches to PR, branch publish progresses, PR moves files -> create -> details. |
| Flows | Blueprint viewport moves across renderer-style dashed elbow edges without status-dot choreography. |
| Browser | Address entry changes, autocomplete appears, active tab loads, and the checkout page settles. |
| Final lockup | Title and tagline animate separately. |

Rules:

- Keep action data in `packages/video/src/film/state/*`.
- Keep shot components focused on composition and timing.
- Maintain at least 10 verified frame-driven moments; the current audit proves 41.
- Maintain at least 10 verified product-surface moments before the final lockup.
- Cover all product shot areas in the audit: notes, chat, threads board, code, flows, and browser.
