# Launch Film Storyboard

## Non-Negotiable Visible Chapter Copy

The Sam/Supafan checkout story is the internal continuity spine. It keeps the UI state coherent across chat, board, notes, code, workflow, calendar, and montage, but it must not replace the launch-film chapter headings.

Visible title cards use the original launch-film copy:

| Shot | Visible copy |
|---|---|
| Intro | AgentBuddy is... |
| Chat | More than just an AI chat |
| Notes | More than just a note taker |
| Code | More than just an IDE |
| Workflow | More than just a workflow engine |
| Calendar | More than just a calendar |
| Montage / lockup | AgentBuddy is a revolution / to put the full power of AI into the hands of the people |

Do not rename these headings to story-specific task names like checkout, Supafan, deploy, PR, branch, or release. Those names belong inside the UI only.

The Montage / lockup copy appears exactly once, as the closing full-screen lockup (final shot). The montage itself follows the calendar chapter directly via a short dissolve — there is no separate montage title card, so the line is never shown twice.

## The Story

**Sam** is a solo indie hacker building **Supafan** — a creator storefront platform where creators sell digital products (courses, templates, assets). Think Gumroad meets Lemon Squeezy. Sam's been building for a few months and is picking up paying creators.

Today Sam is shipping the **checkout flow** — Stripe-powered payments with receipts, discount codes, and creator payouts. This is the make-or-break feature: without a smooth checkout, creators can't sell.

The film follows one work session: plan the feature (Chat) → organize the tickets (Board) → spec the details (Notes) → write the code (Code) → automate the deploy pipeline (Workflow) → schedule the launch (Calendar) → ship it (Montage).

---

## Shared Universe

These are the canonical names, IDs, and values that must appear consistently across every chapter. When a thread, branch, or command shows up in multiple places, it must be identical.

### Threads

| Thread | Short Code | Status Color | Role |
|---|---|---|---|
| Checkout flow implementation | AB-42 | busy (spinner) | Parent thread, the main plan |
| Stripe payment integration | AB-47 | green (#22c55e) | Active child, pinned, the one Sam just finished |
| Deploy checklist | AB-53 | amber (#f59e0b) | Pending, waiting for checkout to land |

### New thread (created during Board)

| Thread | Role |
|---|---|
| Add discount code support | Created in Board's "New Thread" form, linked to parent AB-42. Also appears as a kanban card that moves from Backlog → In Progress, and as a tasklist overview line in Notes |

### Branch & project

| Key | Value |
|---|---|
| Branch | `sam/checkout-flow` |
| Base branch | `main` |
| Project path | `~/Supafan` |
| GitHub repo | `supafan/supafan` |
| Author | `sam` |

### Command (Workflow → Montage)

| Key | Value |
|---|---|
| Command | `/supafan deploy-checkout` |

---

## Chapter 1: Chat

Sam is in the "Checkout flow implementation" thread. They paste a screenshot and reference their notes to scope the checkout feature.

**Breadcrumbs**: "Threads > Checkout flow implementation" initially, switches to "Threads > Stripe payment integration" after loading a recent thread.

**User prompt** (typed with caret): `"Use #notes:tasklist and this screenshot to scope the checkout flow — Stripe payments, receipts, and discount codes."`
- `#notes:tasklist` triggers the reference autocomplete (category list → notes items → pauses on "current" → arrows down to "Tasklist" → selects "Tasklist")
- Image attachment: SVG placeholder showing a Supafan checkout page mockup

**Assistant thinking**: `"Examining the tasklist and screenshot to identify the checkout components and determine the right Stripe integration pattern before creating tickets."`

**Assistant response**: `"I'll scope the checkout feature from the tasklist: create the Stripe integration, wire receipt emails, add the discount engine, and prepare the creator payout stub."`

**Tool activity** (streaming):
1. Read — `notes/supafan/tasklist/current.md` — 312ms — "Checkout tasklist loaded"
2. Task — `create implementation tickets from checkout scope` — 1280ms — "3 tickets created"
3. Write — `packages/api/src/services/checkout-service.ts` — running
4. Bash — `npm run typecheck` — running

**Plan artifact**: "Checkout Implementation Plan"
- Steps: Design payment flow (done), Create tickets (done), Wire Stripe integration (done), Review deploy checklist (running)
- Table: Stripe (wired), Receipts (wired), Discounts (stubbed)
- Quote: "Every creator gets paid. Every buyer gets a receipt."

**Plan markdown** (expanded block):
```
## Supafan Checkout → Implementation Pass

### Context
The checkout thread has the current tasklist, payment requirements, and a product screenshot
in one place. The next step is to turn that context into implementation work without leaving
the thread.

Goal: create the implementation tickets, wire the Stripe integration, and prepare the deploy
path for a shippable PR.

### Key Discovery
The existing tasklist identifies three pillars: Stripe checkout sessions (webhook-driven),
receipt emails (Resend transport), and discount codes (validation middleware). A shared
PaymentProvider interface keeps all three behind one dispatch surface.

### Implementation Plan
- Create implementation tickets for each checkout component.
- Design the PaymentProvider interface and session flow.
- Wire Stripe checkout.session.completed webhook handler.
- Configure Resend receipt emails with order summary template.
- Stub discount code validation endpoint.
- Run integration tests across all payment paths.

### Files
`packages/api/src/services/checkout-service.ts` — session creation and payment confirmation.
`packages/api/src/webhooks/stripe-webhook.ts` — Stripe event handling.
`packages/api/src/services/receipt-service.ts` — Resend email transport.
```

**Recent threads menu** (bottom tabs → click recent → menu appears):
1. "Stripe payment integration" — AB-47 — pinned — green — now
2. "Checkout flow implementation" — AB-42 — busy — 2 min ago
3. "Deploy checklist" — AB-53 — amber — 8 min ago

**After switching to "Stripe payment integration"**:
- Breadcrumbs change to "Threads > Stripe payment integration"
- Bottom tab label changes
- New user message: `"Polish the checkout flow and prepare the PR path."`
- Completed response: `"The checkout flow is wired. Stripe webhook handles payment_intent.succeeded, receipt emails send via Resend, and discount validation works. All three paths pass integration tests."`
- Completed tool activity:
  1. Read — `packages/api/src/services` — "Service directory reviewed"
  2. Edit — `checkout service, Stripe webhooks, receipt emails` — "Payment flow wired"
  3. Edit — `discount engine and validation middleware` — "Discount codes ready"
  4. Bash — `npm test -- --filter checkout` — "Integration tests passed"

**Quick prompt flow**: User clicks quick prompts, selects the review prompt (kept as-is — it's generic), sends it.

---

## Chapter 2: Board

Sam navigates from Chat to the thread board. We see the dashboard, create a new thread, then view the kanban.

**Flow**: Dashboard view → click "New Thread" → fill form → switch to kanban → drag card

### Dashboard view
- **Tabs**: Deploy checklist (pinned), Stripe payment integration (pinned, active), Checkout flow implementation, Receipt email templates
- **Artifact sidebar**: Stripe payment integration (done), Checkout flow implementation (approved), Deploy checklist (ready), Receipt email templates (next)
- **Artifact shown**: Same plan artifact from Chat, but status = "approved"

### Create form
- **Title** (typed): `"Add discount code support"`
- **Instructions** (typed): `"Create the discount code validation endpoint and checkout price adjustment. Link it to the parent checkout thread and keep the Stripe integration visible."`
- **Linked thread**: searches `"Checkout flow implementation"`, selects parent thread AB-42
- **Parent thread tag**: "Checkout flow implementation" / AB-42 / Active / tags: `['checkout']`

### Kanban board
- **Backlog**: "Draft creator payout spec" (parent tag), "Add discount code support"
- **In Progress**: "Wire receipt email templates"
- **Done**: (empty)
- **Moving card**: "Add discount code support" animates from Backlog → In Progress

### Filter popover (demo states)
- Statuses: Active (selected), Paused, Done
- Tags: `checkout` (selected, purple), `payments` (cyan), `bug` (red)

---

## Chapter 3: Notes

Sam opens Notes home, creates a checkout note, then uses the real notes side rail to move into the tasklist overview and complete the receipt email todo.

### Notes Home
- **Greeting**: "Good afternoon"
- **Recent**: current (💳, just now, active), Tasklist (📝, 4m ago), api (🔌, 18m ago)
- **Favorites**: current (💳), Roadmap (🗺️), Design (🎨)
- **Action**: click "+ New note"

### New Note Editor
- **Breadcrumbs**: Notes > Supafan > Checkout Notes
- **Title**: 📝 Checkout notes
- **Typed lines**:
  1. "Stripe webhook integration"
  2. "checkout session flow works in staging"
  3. "add checkout diagram, resize it, and keep tasks nearby"
- **Right rail**: visible once Sam leaves Notes home
- **Action**: click "Tasklist" in the right rail

### Tasklist Overview
- **Breadcrumbs**: Notes > Supafan > Tasklist
- **Title**: 📝 Tasklist
- **Lines**:
  1. "Stripe webhooks"
  2. "current"
  3. "receipt emails"
  4. "Add discount code support"
  5. "Checkout work stays beside the note instead of becoming another app."
- **Continuity**: "Add discount code support" is the same thread created in the Board chapter.
- **Action**: click "receipt emails" in the tasklist panel

### Tasklist Panel (left side)
1. Stripe webhooks (🔧)
2. **current** (💳) — active
3. receipt emails — *clicked, then marked complete*
4. checkout UI
5. discount codes
6. creator payouts
7. product variants
8. landing page redesign (completed, muted)
9. pricing tiers (💰)
10. analytics dashboard

### Receipt Emails Todo
- **Breadcrumbs**: Notes > Supafan > Tasklist > receipt emails
- **Title**: receipt emails
- **Lines**:
  1. "Configure Resend transport"
  2. "Render order summary template"
  3. "Keep the linked checkout context visible"
  4. "Completed from the tasklist panel."
- **Interaction**: checkbox press on "receipt emails" marks it complete in the tasklist panel.

### Right rail
- **Favorites**: current (💳), api (🔌), Roadmap (🗺️)
- **Tree**: Supafan (⚡), Payments (💳), Tasklist (📝), Design (🎨)

---

## Chapter 4: Code

Sam is in the code plugin, working on the checkout branch. Source control shows the implementation progress, then the PR flow.

### Source control panel
- **Base directory**: ~/Supafan
- **Branch**: `sam/checkout-flow`
- **Branch sync**: 4 commits ahead, 0 behind
- **Worktrees**: `sam/checkout-flow` at ~/Supafan (current), `main` at ~/Supafan-main

### Diff view
- **File**: `checkout-service.ts` (line 24)
- **Lines**:
  ```
  context:  "export async function processCheckout(cart, customer) {"
  add:      "  const session = await stripe.checkout.create(cart);"
  add:      "  const receipt = await receipts.generate(session);"
  remove:   "  return createGenericOrder(cart);"
  add:      "  return stripe.confirmPayment({ session, receipt });"
  add:      "  await analytics.track('checkout.completed', session.id);"
  context:  "}"
  ```

### Files
- **Staged**: `packages/api/src/services/checkout-service.ts` (modified)
- **Changed**: `packages/api/src/webhooks/stripe-webhook.ts` (modified), `packages/api/src/services/receipt-service.ts` (added), `packages/api/src/services/discount-service.ts` (added), `packages/worker/src/jobs/payout-worker.ts` (modified)

### Commits (author: sam)
1. `a1b2c3d` — "Add Stripe checkout session and webhook handler" — 2m ago
2. `e4f5g6h` — "Wire receipt email generation with Resend" — 18m ago
3. `i7j8k9l` — "Add checkout service and cart validation" — 1h ago

### Commit flow
- Commit message starts as typed "incomplete work", gets stashed
- Switch to main worktree
- Generated commit message: `"feat(checkout): wire Stripe flow, receipts, and discounts"`

### Terminal (brief appearance)
```
$ npm test -- --filter checkout
> supafan@0.4.0 test
> vitest run --filter checkout

 ✓ checkout-service.test.ts (4 tests)
 ✓ stripe-webhook.test.ts (3 tests)
 ✓ receipt-service.test.ts (2 tests)
 ✓ discount-service.test.ts (3 tests)
All tests passed
```

### PR flow
- **Publish branch** (progress bar)
- **Create PR**: title "Checkout flow", base: main, head: sam/checkout-flow
- **PR body**: "Wire Stripe checkout sessions and webhook handler\nAdd receipt email generation via Resend\nAdd discount code validation service\nKeep the payment flow consistent with creator payout path"
- **PR #42**: OPEN → MERGED, CLEAN merge, APPROVED review
- **Checks**: CI passed, Preview deploy ready
- **PR files**: checkout-service.ts, stripe-webhook.ts (added), receipt-service.ts (added), discount-service.ts (added), payout-worker.ts (modified)
- **Open PRs list**: #42 Checkout flow (OPEN), #38 Creator dashboard analytics (OPEN), #35 Product variant picker (DRAFT)
- **Review comment**: "Verified the webhook handler validates Stripe signatures correctly."

---

## Chapter 5: Workflow

The deploy automation. Starts with just the listener node on black, progressively reveals the full flow canvas.

### Flow canvas
- **Breadcrumbs**: Flows > Root Flow (Root)
- **Nodes**:
  1. Listener — "start command listener" (user.command)
  2. Switch — `"is /supafan deploy-checkout"` — branches: `/supafan deploy-checkout`, Else
  3. Action — "Run database migrations"
  4. Action — "Notify #releases channel"
- **Edges**: listener → switch → migrations / notify (elbow routing)

### Flow list (sidebar)
1. Root Flow — "Default entrypoint for Supafan"
2. **Deploy Checkout** — "Checkout feature deploy pipeline" (selected)
3. Post-purchase Flow — "Receipt and payout automation"
4. Creator Onboarding — "New creator setup wizard"
5. Daily Digest — "Scheduled sales summary"

---

## Chapter 6: Calendar

Launch morning. Sam opens the calendar to lock in the moment the checkout ships. Title card eyebrow `5`, copy "More than just a calendar". The shot dissolves into the montage.

### Month view (source frames 0–80)
- **Breadcrumbs**: Calendar
- **Header**: ‹ June 2026 › · Today · New Event
- **Today pill**: Sat Jun 27 (blue)
- **Seeded events**: Jun 18 "10:30 AM Deploy checklist", Jun 22 all-day "Beta freeze", Jun 25 "2:00 PM Stripe webhook review"
- Cursor moves to the day-number pill on the 27th and clicks (frames 56–76)

### Day view (source frames 80–270)
- **Breadcrumbs**: Calendar > Jun 27, 2026
- **Header label**: Saturday, June 27, 2026
- Hour grid scrolled to 8 AM; red now-line at 9:12 AM (it's launch morning)
- Cursor clicks the 10 AM slot (frames 104–122) → New Event dialog opens
- Dialog types `Launch Supafan checkout`, 06/27/2026 10:00 AM – 11:00 AM (frames 142–186)
- Cursor clicks Save (frames 194–210) → dialog closes, the event block fades into the 10–11 AM slot (frames 218–230)
- Hold on the scheduled launch until the montage dissolve

Calendar frame ranges are source frames from `calendarBeats` in `src/film/state/calendar.ts`; the shot currently has no edit cuts (`shotCuts.calendar = []`).

---

## Chapter 7: Montage

Quick flashes across plugin surfaces showing the deploy in action.

### Threads (frames 0–72)
- Active thread: Deploy checklist
- Command typed: `/supafan deploy-checkout`
- Response: `"Matched the deploy-checkout command, ran migrations, and notified the #releases channel."`

### Logs (frames 72–142)
- Entries referencing the deploy-checkout pipeline, database migrations, command routing

### Database (frames 142–252)
- Query results referencing checkout/payment messages

### Browser (frames 252–360)
- The deployed checkout page loads at `https://supafan.app/checkout`. Do not show Settings or mutate default app configuration in the launch film.

Montage frame ranges above are source frames (the coordinates used by `montageShotViewForFrame` and the audits). The presented shot is shorter: dead air is removed by the per-shot edit decision lists in `src/film/state/timeline.ts`, and each segment boundary crosses with a short dissolve instead of a hard cut.

---

## Continuity Map

```
Chat                    Board                   Notes                   Code                    Workflow / Montage
─────────────────────── ─────────────────────── ─────────────────────── ─────────────────────── ──────────────────────
"Checkout flow          Dashboard tab           —                       —                       —
 implementation"        Artifact sidebar
 AB-42 (busy)           Create form parent

"Stripe payment         Dashboard tab           —                       Commit: "Add Stripe     —
 integration"           (pinned, active)                                checkout session..."
 AB-47 (pinned, green)

"Deploy checklist"      Dashboard tab (pinned)  —                       —                       —
 AB-53 (amber)

"Add discount code      Kanban card (moving)    Tasklist overview       PR file:                —
 support"               Create form title       line                    discount-service.ts
                                                Linked todo in tasklist

sam/checkout-flow       —                       —                       Branch, worktree,       —
                                                                        stash, PR head

/supafan deploy-        —                       —                       —                       Switch node label,
checkout                                                                                        Montage command

receipt emails          Board kanban:           Tasklist item           Commit: "Wire receipt   —
                        "Wire receipt email      (marked complete)       email generation..."
                         templates"

checkout-service.ts     —                       —                       Diff file, staged       —
                                                                        Tool activity (Write)
```

---

## Implementation Source Of Truth

`STORYBOARD.md` is the source of truth for story, continuity, and chapter beats. State files and shot logic should be changed as needed to make the rendered film match this document. Do not preserve a stale animation, component state, or demo beat just because it already exists.

| File | What it owns |
|---|---|
| `state/launchStory.ts` | Central story constants — all thread names/IDs, branch, command, flow labels. Other files import from here. |
| `state/chat.ts` | All prompt/response text, plan content, tool activity, recent threads, thinking block |
| `state/board.ts` | Dashboard tabs, kanban cards, create form, artifact sidebar, filter tags |
| `state/notes.ts` | Tasklist items, editor copy, right rail, home cards, thread reference, SVG image |
| `state/code.ts` | Branch, diff, commits, PR details, terminal output, worktrees, author |
| `state/workflow.ts` | Switch label, action labels, flow list |
| `state/calendar.ts` | Month label, seeded events, launch event title/times, beat table |
| `state/paths.ts` | Project directory paths |
| `state/logs.ts` | Log entries referencing checkout/deploy |
| Montage-related state (MontageShot.tsx or wherever montage data lives) | Command, response text |

When the film diverges from this storyboard, update the state, shot composition, or reusable UI component required to restore continuity. Avoid invented settings/default-configuration beats unless the storyboard explicitly calls for them.
