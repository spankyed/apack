import type {CodeReviewState, CodeReviewViewState, TerminalPanelState} from '../../agentbuddy-ui/code/codeTypes';
import {launchFilmStory} from './launchStory';
import {filmProjects} from './paths';
import {ease} from './timeline';
import {revealText} from './typing';

export type CodeShotState = {
  breadcrumbs: string[];
  chromeDemoBreadcrumbs: string[];
  generatedCommitMessage: string;
  review: CodeReviewState;
};

export type CodeShotView = {
  breadcrumbs: string[];
  review: {
    state: CodeReviewState;
    view: CodeReviewViewState;
  };
};

export const codeShotState: CodeShotState = {
  breadcrumbs: ['Code'],
  chromeDemoBreadcrumbs: ['Code'],
  generatedCommitMessage: 'feat(checkout): wire Stripe flow, receipts, and discounts',
  review: {
    baseDirectory: filmProjects.supafan,
    branch: launchFilmStory.branch,
    branchSync: {
      commitsAhead: 4,
      commitsBehind: 0,
      hasUpstream: true,
    },
    diff: {
      fileName: 'checkout-service.ts',
      lineStart: 24,
      lines: [
        {kind: 'context', text: 'export async function processCheckout(cart, customer) {'},
        {kind: 'add', text: '  const session = await stripe.checkout.create(cart);'},
        {kind: 'add', text: '  const receipt = await receipts.generate(session);'},
        {kind: 'remove', text: '  return createGenericOrder(cart);'},
        {kind: 'add', text: '  return stripe.confirmPayment({ session, receipt });'},
        {kind: 'add', text: "  await analytics.track('checkout.completed', session.id);"},
        {kind: 'context', text: '}'},
      ],
    },
    staged: [
      {path: 'packages/api/src/services/checkout-service.ts', status: 'modified'},
    ],
    changes: [
      {path: 'packages/api/src/webhooks/stripe-webhook.ts', status: 'modified'},
      {path: 'packages/api/src/services/receipt-service.ts', status: 'added'},
      {path: 'packages/api/src/services/discount-service.ts', status: 'added'},
      {path: 'packages/worker/src/jobs/payout-worker.ts', status: 'modified'},
    ],
    commits: [
      {authorName: launchFilmStory.author, hash: 'a1b2c3d', title: 'Add Stripe checkout session and webhook handler', time: '2m ago'},
      {authorName: launchFilmStory.author, hash: 'e4f5g6h', title: 'Wire receipt email generation with Resend', time: '18m ago'},
      {authorName: launchFilmStory.author, hash: 'i7j8k9l', title: 'Add checkout service and cart validation', time: '1h ago'},
    ],
    stashes: [],
    worktrees: [
      {branch: launchFilmStory.branch, path: launchFilmStory.projectPath, current: true},
      {branch: launchFilmStory.baseBranch, path: '~/Supafan-main'},
    ],
    pullRequest: {
      baseBranch: launchFilmStory.baseBranch,
      body: [
        'Wire Stripe checkout sessions and webhook handler',
        'Add receipt email generation via Resend',
        'Add discount code validation service',
        'Keep the payment flow consistent with creator payout path',
      ].join('\n'),
      branchPublished: false,
      changedFiles: [
        {path: 'packages/api/src/services/checkout-service.ts', status: 'modified'},
        {path: 'packages/api/src/webhooks/stripe-webhook.ts', status: 'added'},
        {path: 'packages/api/src/services/receipt-service.ts', status: 'added'},
        {path: 'packages/api/src/services/discount-service.ts', status: 'added'},
        {path: 'packages/worker/src/jobs/payout-worker.ts', status: 'modified'},
      ],
      comments: [
        {
          authorName: launchFilmStory.author,
          body: 'This is ready for review. The checkout flow now validates Stripe signatures, sends receipts, applies discount codes, and keeps the payout path intact.',
          createdAt: 'just now',
          id: 'discussion-1',
          viewerDidAuthor: true,
        },
      ],
      checks: [
        'CI passed',
        'Preview deploy ready',
      ],
      createdPr: {
        authorName: launchFilmStory.author,
        baseBranch: launchFilmStory.baseBranch,
        commitCount: 9,
        createdAt: 'just now',
        headBranch: launchFilmStory.branch,
        isDraft: false,
        mergeStateStatus: 'CLEAN',
        mergeable: 'MERGEABLE',
        number: 42,
        reviewDecision: 'APPROVED',
        state: 'OPEN',
        statusCheckRollup: [
          {conclusion: 'SUCCESS', name: 'CI', status: 'COMPLETED'},
          {conclusion: 'SUCCESS', name: 'Preview deploy', status: 'COMPLETED'},
        ],
        url: 'https://github.com/supafan/supafan/pull/42',
      },
      fileTree: [
        {
          id: 'packages',
          label: 'packages',
          type: 'folder',
          count: 7,
          children: [
            {
              id: 'packages/api',
              label: 'api',
              type: 'folder',
              count: 3,
              children: [
                {
                  id: 'packages/api/src',
                  label: 'src',
                  type: 'folder',
                  count: 3,
                  children: [
                    {
                      id: 'packages/api/src/services',
                      label: 'services',
                      type: 'folder',
                      count: 3,
                      children: [
                        {id: 'checkout-service.ts', label: 'checkout-service.ts', type: 'file', status: 'modified'},
                        {id: 'receipt-service.ts', label: 'receipt-service.ts', type: 'file', status: 'added'},
                        {id: 'discount-service.ts', label: 'discount-service.ts', type: 'file', status: 'added'},
                      ],
                    },
                    {
                      id: 'packages/api/src/webhooks',
                      label: 'webhooks',
                      type: 'folder',
                      count: 1,
                      children: [
                        {id: 'stripe-webhook.ts', label: 'stripe-webhook.ts', type: 'file', status: 'added'},
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
      headBranch: launchFilmStory.branch,
      openPullRequests: [
        {number: 42, state: 'OPEN', title: 'Checkout flow'},
        {number: 38, state: 'OPEN', title: 'Creator dashboard analytics'},
        {isDraft: true, number: 35, state: 'DRAFT', title: 'Product variant picker'},
      ],
      reviewThreads: [
        {
          comments: [
            {
              authorName: 'reviewbot',
              body: 'Verified the webhook handler validates Stripe signatures correctly.',
              createdAt: 'just now',
              id: 'review-comment-1',
            },
          ],
          diffLines: [
            {kind: 'meta', text: '@@ -24,7 +24,8 @@'},
            {kind: 'context', text: ' export async function handleStripeWebhook(event) {'},
            {kind: 'removed', text: '-  return orders.markPaid(event.data.object.id);'},
            {kind: 'added', text: '+  await stripe.verifySignature(event);'},
            {kind: 'added', text: '+  return checkout.confirmPayment(event.data.object);'},
          ],
          id: 'review-thread-1',
          isResolved: false,
          location: 'Comment on line +25',
          path: 'packages/api/src/webhooks/stripe-webhook.ts',
        },
      ],
      selectedCommentTab: 'discussion',
      title: 'Checkout flow',
    },
    terminal: {
      activeTerminalId: 'terminal-checkout',
      expanded: false,
      terminals: [
        {id: 'terminal-checkout', shell: 'zsh', title: 'Supafan'},
      ],
    },
  },
};

export const expandedTerminalPanelState: TerminalPanelState = {
  ...codeShotState.review.terminal,
  expanded: true,
  output: [
    '$ npm test -- --filter checkout',
    '',
    '> supafan@0.4.0 test',
    '> vitest run --filter checkout',
    '',
    '✓ checkout-service.test.ts (4 tests)',
    '✓ stripe-webhook.test.ts (3 tests)',
    '✓ receipt-service.test.ts (2 tests)',
    '✓ discount-service.test.ts (3 tests)',
    'All tests passed',
  ].join('\n'),
};

export const sourceControlPanelReviewState: CodeReviewState = {
  ...codeShotState.review,
  worktrees: codeShotState.review.worktrees.slice(0, 1),
};

export function codeReviewViewForFrame(frame: number): CodeReviewViewState {
  const prPublishProgress = ease(frame, 318, 350);
  const prCreated = frame > 380;
  const prMerged = frame > 404;
  return {
    activePanel: frame < 48 || frame > 316 ? 'pr' : 'commit',
    commitButtonPressed: frame > 204 && frame <= 214,
    commitMenuActionPressed: frame > 128 && frame < 140,
    commitMenuOpen: frame > 112 && frame < 142,
    commitMessage: frame < 142
      ? revealText('incomplete work', frame, 56)
      : revealText(codeShotState.generatedCommitMessage, frame, 184, 'stream'),
    diffLineOpacities: codeShotState.review.diff.lines.map((line, index) =>
      line.kind === 'context' ? 1 : ease(frame, 42 + index * 12, 60 + index * 12),
    ),
    generateCommitPressed: frame > 148 && frame <= 158,
    generatingCommitMessage: frame > 154 && frame <= 184,
    leftSurface: frame < 72 ? 'blank' : frame > 220 && frame < 258 ? 'terminal' : frame >= 258 && frame < 316 ? 'blank' : 'diff',
    prMode: frame <= 350 ? 'files' : frame <= 380 ? 'create' : 'details',
    prCreatePressed: frame > 368 && frame <= 380,
    prMergePressed: frame > 394 && frame <= 404,
    prPublishPressed: frame > 318 && frame <= 328,
    pullRequest: {
      ...codeShotState.review.pullRequest,
      branchPublished: prPublishProgress >= 1,
      createdPr: prCreated
        ? {
            ...codeShotState.review.pullRequest.createdPr!,
            state: prMerged ? 'MERGED' : codeShotState.review.pullRequest.createdPr!.state,
          }
        : undefined,
    },
    prPublishProgress,
    stageActionPressed: frame > 132 && frame <= 142,
  };
}

export function codeShotViewForFrame(frame: number): CodeShotView {
  const initialStaged = codeShotState.review.staged;
  const initialChanges = codeShotState.review.changes;
  const stashedInitialWork = frame >= 142;
  const stagedReviewedWork = frame >= 142 && frame < 214;
  const committedReviewedWork = frame >= 214;
  const checkedOutMainWorktree = frame >= 154 && frame < 184;
  const reviewState: CodeReviewState = {
    ...codeShotState.review,
    branch: checkedOutMainWorktree ? launchFilmStory.baseBranch : codeShotState.review.branch,
    changes: stagedReviewedWork || committedReviewedWork ? [] : initialChanges,
    commits: committedReviewedWork
      ? [
          {authorName: launchFilmStory.author, hash: 'c0ffee1', title: codeShotState.generatedCommitMessage, time: 'just now'},
          ...codeShotState.review.commits,
        ]
      : codeShotState.review.commits,
    staged: stashedInitialWork
      ? stagedReviewedWork
        ? initialChanges
        : []
      : initialStaged,
    stashes: stashedInitialWork
      ? [
          {
            branch: launchFilmStory.branch,
            date: 'just now',
            message: `WIP on ${launchFilmStory.branch}: incomplete work`,
            ref: 'stash@{0}',
          },
        ]
      : [],
    stashesExpanded: frame >= 142 && frame < 170,
    terminal: frame > 220 && frame < 316 ? expandedTerminalPanelState : codeShotState.review.terminal,
    worktrees: codeShotState.review.worktrees.map(worktree => ({
      ...worktree,
      current: checkedOutMainWorktree ? worktree.branch === launchFilmStory.baseBranch : worktree.branch === launchFilmStory.branch,
      pressed: frame > 142 && frame < 154 && worktree.branch === launchFilmStory.baseBranch,
    })),
  };

  return {
    breadcrumbs: codeShotState.breadcrumbs,
    review: {
      state: reviewState,
      view: codeReviewViewForFrame(frame),
    },
  };
}
