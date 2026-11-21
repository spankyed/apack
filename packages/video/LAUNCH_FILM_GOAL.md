# AgentBuddy Launch Film Goal

## Mission

Ship a polished Remotion-driven AgentBuddy launch film that feels authored and cinematic while showing UI that is recognizably the real product.

The film is built from reusable React/Remotion replicas of AgentBuddy UI, not Electron captures, Playwright screenshots, screenshot carousels, or invented product screens.

## Source Of Truth

`packages/video/STORYBOARD.md` is the canonical source for the launch film.

This goal file does not define the story. It defines how we build and judge the film.
When implementing, reviewing, or fixing any shot, read the relevant storyboard section
first and treat it as the contract for what should be visible.

Use the storyboard for:

- Persona, project, product story, and overall narrative arc.
- Non-negotiable visible chapter headings and title-card copy.
- Canonical thread names, IDs, statuses, tags, branch names, paths, commands, authors, and repo names.
- Chapter order, visible beats, copy, typed text, menus, cards, plan content, PR content, workflow labels, and montage content.
- Cross-chapter continuity, including any item that appears in more than one place.

If this goal file, film state, shot timing, component copy, or rendered output conflicts with `STORYBOARD.md`, treat the storyboard as correct. Change implementation to match the storyboard. Only change the storyboard first when intentionally revising the film's story.

Before adding or changing a shot:

- Confirm the beat exists in `packages/video/STORYBOARD.md`.
- Reuse storyboard names, IDs, paths, tags, branches, commands, status labels, and copy.
- Do not introduce new threads, plugin states, feature names, or fake product surfaces unless the storyboard is updated first.
- Keep implementation details in `packages/video/src/**`; keep narrative decisions in `packages/video/STORYBOARD.md`.

## Non-Negotiables

- The visible chapter headings are the original launch-film copy, not story-state labels:
  AgentBuddy is...; More than just an AI chat; More than just a note taker; More than just an IDE; More than just a workflow engine; AgentBuddy is a revolution / to put the full power of AI into the hands of the people.
  The revolution line appears exactly once, as the closing lockup; the montage has no separate title card.
- The Sam/Supafan checkout story is internal continuity for UI content only. Do not rename title cards to checkout, branch, deploy, PR, or release-specific copy.
- Every app-like surface must be source-backed by renderer code, renderer styles, or current app screenshots.
- Shared replicas live in `packages/video/src/agentbuddy-ui/**`; shots compose those replicas instead of creating local fake UI.
- Film-only elements, captions, cursor layers, camera choreography, and external preview windows live outside `agentbuddy-ui`.
- If a UI surface is not faithful enough, remove it from the cut until it can be rebuilt properly.
- Do not add fake plugin panels, fake browser panes, fake typing indicators, filler grids, black-flash transitions, or whole-app grow-ins.

## Current Scope

Required for this launch film:

- Story continuity: one session following the exact story defined in `STORYBOARD.md`.
- Shared canonical state: threads, recent threads, dashboard tabs, kanban cards, notes references, branch/worktree/PR data, workflow command, logs, and database results must reuse the same names/IDs across chapters.
- App chrome and toolbar, including correct icons, active states, and pinned lower plugins.
- Chat and threads: composer, messages, tool activity, references, artifacts, recent threads, and thread board navigation.
- Notes: home, search, new note, editor, right rail, tasklist panel, task rows, and checkbox completion.
- Code and PR: source control, pull request files/create/details views, terminal, Monaco-backed code views, and a separate chrome-like localhost preview prop.
- Flows: blueprint canvas, palette, nodes, handles, and real elbow-edge routing for the `/supafan deploy-checkout` workflow.
- Final lockup: brand copy on plain black, not inside app chrome.

Out of scope until rebuilt with the same fidelity:

- Brain, settings, prompts, actions, library, and any montage beat that depends on unfinished plugin UI.

## Motion Standard

- Component-first moments must spatially resolve into the real app layout.
- Individual components can appear first, but they should slide or settle into the exact place they occupy in the full UI.
- Normal navigation should behave like the app: click the real control, then show the destination state directly.
- Do not hide missing states with black frames, crossfades, centered cards, or whole-app scale transitions.
- Product UI and film-only props must remain visually and structurally separate.

## Chapter Rules

Do not duplicate or invent story beats in this file. Detailed chapter content lives in `packages/video/STORYBOARD.md`; this section only captures implementation rules.

- Chat and threads: use the storyboard's prompt, reference flow, thinking state, plan message, recent thread switch, quick prompt flow, and board navigation. Navigate with real controls. Avoid black frames and grow-in transitions.
- Board: use the storyboard's dashboard, create form, linked parent, list/kanban state, and card movement. Do not create, pin, select, move, or change thread state without a visible mouse action when the real app would require one.
- Notes: use the storyboard's Notes home, editor, right rail, tasklist panel, typed lines, image resize, checkbox completion, and thread reference chip. Do not show chat composer or thread tabs in Notes shots unless the real Notes plugin would.
- Code and PR: use the storyboard's project path, branch, files, diff, terminal, publish branch, create PR, PR details, checks, and PR file list. Use Monaco for code viewers. Show localhost output in a separate chrome-like film prop, never as an in-app fake browser.
- Flows: use the storyboard's blueprint workflow. Start isolated with only the listener node, attach the switch node, then progressively reveal the real app canvas, header, toolbar, palette, and follow-on nodes. Do not show brain-plugin runtime/status UI. Route edges as app-like elbow paths attached to real handles.
- Montage: use only the storyboard's command, logs, and database beats. Do not include settings/default-configuration edits, unrelated obsolete-app, AgentBuddy-launch-film, fake plugin, or filler-grid beats.
- Final: use only brand copy on black. Do not wrap the final lockup in app chrome.

## Working Loop

1. Pick the next visible weak segment.
2. Inspect renderer source and screenshots for that exact UI.
3. Patch shared replica components or state, not one-off shot mockups.
4. Render or sample the affected section.
5. Repeat until the section reads as the real app before expanding scope.

Keep fidelity notes useful and brief. Do not spend more time auditing than building, and do not add audit files unless they directly guide implementation.

## Done Criteria

- Landscape and square renders complete.
- Chat, threads, notes, code/PR, and flows show visible product action.
- Every visible app-like surface is source-backed or screenshot-backed.
- Component-to-app transitions are spatially coherent.
- No known ad hoc app UI remains in the cut.
