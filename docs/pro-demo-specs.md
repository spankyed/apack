Current working goal:

Polish the existing Remotion launch film into a professional AgentBuddy demo by reviewing the rendered video in motion, fixing visible fidelity and pacing issues as they appear, and keeping every UI surface grounded in near-1:1 replicas of the real Vue app. Prioritize concrete improvements over broad audits: when a section looks wrong, patch the component/state/timing that causes it, render again, and continue through the film.

Non-negotiables:
- Use real Remotion-driven sequencing and motion, not Electron/Playwright screenshots.
- Keep UI components split into source-mirrored files, not giant one-off shot files.
- Do not add fake/ad-hoc plugin UIs, loading indicators, chrome, or decorative filler that does not exist in the app.
- Each chapter must reveal progressively: start with one or two focused components centered in frame, then animate those same components into their real position inside the full app UI. Do not cut abruptly from an isolated component to the entire app.
- The transition from component focus to full UI is a primary quality bar. App chrome, sidebars, panels, and neighboring surfaces should slide/fade/scale into place around the already-visible component so the viewer understands where it lives.
- Review passes must treat component-to-app continuity as a central defect class: if a shot cuts from a floating component to a full surface without the component visibly becoming part of that surface, fix the shot timing/layout before moving on.
- Chat composer surfaces should float over the canvas like the real app. Do not add a separate bottom container band, alternate background color, or fake dock behind the input.
- Chapter 1 is the benchmark for this reveal grammar: the chat input starts centered, then moves down into its real composer position while the thread canvas, header, toolbar, and bottom tabs assemble around it.
- The montage should show real AgentBuddy surfaces and pay off prior actions, not random feature tiles.
- The final screen should be plain black with `clientlabs.com` and `June 19th`.

intro: AgentBuddy is:

\-- 1

More than just an AI chat
- initially just show the chat input
  - progressively show and click `+ new thread` button
  - progressively show the rest of the chat area (small) - sliding in from the top - chat input slides down
  - type a prompt, reference a note and paste an image
  - press send
- click recent threads area
  - open a thread that just completed
    - progressively slide in the messages quickly 1 by 1
  - mouse over and click quick prompts menu than send a quick prompt message - "write a commit"
- focus and click the thread title under chat input to open dashboard tabs
  - ok to progressively show entire app layout at this point, should have enough pieces to where it isnt jarring switching to threads dashboard
  - the new thread created in the previous scene should show a plan artifact
  - pin the new thread
- click new thread button in the thread plugin canvas header row
  - type in instructions, than a title - for another new thread create form
  - link to a parent ticket/thread through the UI
  - click the create button
  - than click the kanban view button
  - move newly create thread into the 'in-progress' board on the kanban view
    - claude-code tag shows on the thread
- end of scene

\-- 2

More than just a note taker
- show recent notes or notes home state UI initially
- click a note card to open a note
- edit note text and add an image - than resize the image through bubble menu
- now can "progressively slide in" notes side panel: click to open a tasklist in the notes side panel
  - mark another todo as completed
  - create a todo
    - add a pill link to the thread created in the previous chapter with #threads: \[thread\]
- end of scene

\-- 3

More than just an IDE
- show the right side panel with the directory / project select UI initially
- type out a commit message "incomplete work"
  - stash staged code
- checkout a worktree through the worktree UI in the commits feature panel
- now "progressively slide in" canvas/editor to the left of the code plugin right side panel: review unstaged code from worktree
  - stage the unstaged code
  - click generate commit message button
  - click commit button
- open terminal to start app
  - open an app/ fake app that just shows a page that says "anti-gravity" sucks
- than click the publish (now showing in place of the commit button)
  - switch over to the PR panel
  - and create a PR
  - merge the PR

\-- 4

More than just a workflow engine

- show a listener step for `user.command` only initially. than progressively show:
  - attach a switch step and have a condition branch for is `/replace-obsolete-apps`
  - add a step for "finding and deleting all obselete apps"
  - show the form to edit the step
    - write code to find apps:
      - anti-gravity, cursor, vscode
      - notion, obsidian, tick-tick
    - add a log for "all obsolete apps removed" - will show the result/log briefly in the next chapter

\-- 5

AgentBuddy is a revolution to put the full power of AI into the hands of the people
- no progress showing necessary - show full app to quickly go between scenes - its ok to somewhat overwhelm the user here - we've warmed them up and now want to go quick fire through more things they can expect.
- type /replace-obsolete-apps in the chat input, and pressing enter
- check log plugin for logs for "all obsolete apps removed'
- query for something in the database plugin
  - be creative here - I'm running out ideas - something coherent to the story being told
- checking for brain plugin
  - check trace and out for /replace-obsolete-apps execution
- open settings to provider settings

outro: Clientlabs.com, june 19th
