import type {CodeReviewState, CodeReviewViewState, TerminalPanelState} from '../../agentbuddy-ui/code/codeTypes';
import type {ChatComposerState} from '../../agentbuddy-ui/chat/chatTypes';
import {launchComposerState} from './chat';
import {ease} from './timeline';

export type CodeShotState = {
  breadcrumbs: string[];
  chromeDemoBreadcrumbs: string[];
  generatedCommitMessage: string;
  review: CodeReviewState;
};

export type CodeShotView = {
  breadcrumbs: string[];
  composer: ChatComposerState;
  review: {
    state: CodeReviewState;
    view: CodeReviewViewState;
  };
};

export const codeShotState: CodeShotState = {
  breadcrumbs: ['Code'],
  chromeDemoBreadcrumbs: ['Code'],
  generatedCommitMessage: 'feat(video): align launch film surfaces with app UI',
  review: {
    baseDirectory: '/Users/spankyed/Develop/Projects/AgentBuddy',
    branch: 'as/react-launch-film',
    branchSync: {
      commitsAhead: 4,
      commitsBehind: 0,
      hasUpstream: true,
    },
    diff: {
      fileName: 'AgentBuddyFilm.tsx',
      lineStart: 24,
      lines: [
        {kind: 'context', text: 'export async function prepareLaunchPlan(context) {'},
        {kind: 'add', text: '  const notes = await memory.collectLinkedNotes(context);'},
        {kind: 'add', text: '  const tickets = await threads.createExecutionTickets(notes);'},
        {kind: 'remove', text: '  await handoff.writeChecklist(tickets);'},
        {kind: 'add', text: '  await workflows.scheduleReleaseChecks(tickets);'},
        {kind: 'context', text: '}'},
      ],
    },
    staged: [
      {path: 'packages/video/src/film/AgentBuddyFilm.tsx', status: 'modified'},
    ],
    changes: [
      {path: 'packages/video/src/agentbuddy-ui/threads/KanbanBoard.tsx', status: 'modified'},
      {path: 'packages/video/src/agentbuddy-ui/code/CodeDiffView.tsx', status: 'added'},
      {path: 'packages/video/src/film/state/timeline.ts', status: 'modified'},
    ],
    commits: [
      {authorName: 'spankyed', hash: '9f42c8a', title: 'Improve launch film code surface', time: '2m ago'},
      {authorName: 'spankyed', hash: '77bb1e4', title: 'Align tasklist rows with renderer', time: '18m ago'},
      {authorName: 'spankyed', hash: '43d0ac9', title: 'Add Remotion app chrome primitives', time: '1h ago'},
    ],
    worktrees: [
      {branch: 'as/react-launch-film', path: '~/AgentBuddy', current: true},
      {branch: 'master', path: '~/AgentBuddy-master'},
    ],
    pullRequest: {
      baseBranch: 'master',
      body: [
        'feat(video): rebuild demo system as Vue film stage',
        'feat(video): rebuild demo as Remotion component film',
        'Rebuilt the flows shot around actual flow components: palette, node variants, Flow Entry, handles, dashed elbow edges, Back button.',
        'refactor(video): split launch film into source-mirrored UI components',
        'Realistic tasklist panel',
        'Polish AgentBuddy video UI surfaces',
      ].join('\n'),
      branchPublished: false,
      changedFiles: [
        {path: 'packages/video/src/agentbuddy-ui/code/PullRequestPanel.tsx', status: 'added'},
        {path: 'packages/video/src/agentbuddy-ui/code/PRComparison.tsx', status: 'added'},
        {path: 'packages/video/src/agentbuddy-ui/code/CreatePRForm.tsx', status: 'added'},
        {path: 'packages/video/src/agentbuddy-ui/code/PRInfo.tsx', status: 'added'},
        {path: 'packages/video/src/agentbuddy-ui/code/PRActionBar.tsx', status: 'added'},
        {path: 'packages/video/src/film/state/code.ts', status: 'modified'},
        {path: 'packages/video/src/compositions/demos/CodeDemos.tsx', status: 'modified'},
      ],
      checks: [
        'Preview build passed',
        'Release checks passed',
      ],
      createdPr: {
        authorName: 'spankyed',
        baseBranch: 'master',
        commitCount: 9,
        createdAt: 'just now',
        headBranch: 'as/react-launch-film',
        isDraft: false,
        number: 128,
        state: 'OPEN',
        url: 'https://github.com/clientlabs/agentbuddy/pull/128',
      },
      fileTree: [
        {
          id: 'packages',
          label: 'packages',
          type: 'folder',
          count: 7,
          children: [
            {
              id: 'packages/video',
              label: 'video',
              type: 'folder',
              count: 7,
              children: [
                {
                  id: 'packages/video/src',
                  label: 'src',
                  type: 'folder',
                  count: 7,
                  children: [
                    {
                      id: 'packages/video/src/agentbuddy-ui',
                      label: 'agentbuddy-ui',
                      type: 'folder',
                      count: 5,
                      children: [
                        {
                          id: 'packages/video/src/agentbuddy-ui/code',
                          label: 'code',
                          type: 'folder',
                          count: 5,
                          children: [
                            {id: 'PullRequestPanel.tsx', label: 'PullRequestPanel.tsx', type: 'file', status: 'added'},
                            {id: 'PRComparison.tsx', label: 'PRComparison.tsx', type: 'file', status: 'added'},
                            {id: 'CreatePRForm.tsx', label: 'CreatePRForm.tsx', type: 'file', status: 'added'},
                            {id: 'PRInfo.tsx', label: 'PRInfo.tsx', type: 'file', status: 'added'},
                            {id: 'PRActionBar.tsx', label: 'PRActionBar.tsx', type: 'file', status: 'added'},
                          ],
                        },
                      ],
                    },
                    {
                      id: 'packages/video/src/film',
                      label: 'film',
                      type: 'folder',
                      count: 1,
                      children: [
                        {id: 'code.ts', label: 'code.ts', type: 'file', status: 'modified'},
                      ],
                    },
                    {
                      id: 'packages/video/src/compositions',
                      label: 'compositions',
                      type: 'folder',
                      count: 1,
                      children: [
                        {id: 'CodeDemos.tsx', label: 'CodeDemos.tsx', type: 'file', status: 'modified'},
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
      headBranch: 'as/react-launch-film',
      title: 'Align launch film with app UI',
    },
    terminal: {
      activeTerminalId: 'terminal-launch',
      expanded: false,
      terminals: [
        {id: 'terminal-launch', shell: 'zsh', title: 'AgentBuddy'},
      ],
    },
  },
};

export const expandedTerminalPanelState: TerminalPanelState = {
  ...codeShotState.review.terminal,
  expanded: true,
  output: [
    '$ npm run video:verify',
    '',
    '> abuddy@0.3.4 video:verify',
    '> npm run verify --workspace @app/video',
    '',
    'Fidelity audit passed: 37 referenced demos registered',
    'Film action audit passed: 19 frame-driven shot checks',
    'tsc --noEmit',
  ].join('\n'),
};

export const sourceControlPanelReviewState: CodeReviewState = {
  ...codeShotState.review,
  worktrees: codeShotState.review.worktrees.slice(0, 1),
};

export function codeReviewViewForFrame(frame: number): CodeReviewViewState {
  const prPublishProgress = ease(frame, 158, 188);
  const prCreated = frame > 224;
  return {
    activePanel: frame > 158 ? 'pr' : 'commit',
    commitMessage: frame > 116 ? codeShotState.generatedCommitMessage : '',
    diffLineOpacities: codeShotState.review.diff.lines.map((line, index) =>
      line.kind === 'context' ? 1 : ease(frame, 42 + index * 12, 60 + index * 12),
    ),
    generatingCommitMessage: frame > 76 && frame <= 116,
    prMode: frame <= 176 ? 'files' : frame <= 224 ? 'create' : 'details',
    pullRequest: {
      ...codeShotState.review.pullRequest,
      branchPublished: prPublishProgress >= 1,
      createdPr: prCreated ? codeShotState.review.pullRequest.createdPr : undefined,
    },
    prPublishProgress,
  };
}

export function codeShotViewForFrame(frame: number): CodeShotView {
  return {
    breadcrumbs: codeShotState.breadcrumbs,
    composer: launchComposerState,
    review: {
      state: codeShotState.review,
      view: codeReviewViewForFrame(frame),
    },
  };
}
