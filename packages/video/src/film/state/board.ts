import type {KanbanBoardState, KanbanCardState, ThreadsHeaderState} from '../../agentbuddy-ui/threads/threadTypes';
import {ease, mix} from './timeline';

export type BoardShotView = {
  board: KanbanBoardState;
  breadcrumbs: string[];
  header: ThreadsHeaderState;
  movingCard: {
    card: KanbanCardState;
    style: {
      left: string;
      top: string;
      transform: string;
    };
  };
};

export const boardShotState: {
  board: KanbanBoardState;
  breadcrumbs: string[];
  header: ThreadsHeaderState;
  movingCard: {
    card: KanbanCardState;
    motion: {
      from: number;
      fromLeft: number;
      fromRotation: number;
      fromTop: number;
      to: number;
      toLeft: number;
      toRotation: number;
      toTop: number;
    };
  };
} = {
  breadcrumbs: ['Threads', 'Board'],
  header: {
    activeView: 'kanban',
    filterLabel: 'Filter',
    newThreadLabel: 'New Thread',
    searchPlaceholder: 'Search threads...',
    subtitle: 'Manage agent threads',
  },
  board: {
    columns: [
      {
        cards: [{title: 'Ship capture-state renderer', tags: ['video']}],
        title: 'Backlog',
        tone: 'neutral',
      },
      {
        cards: [{title: 'Automate release checks', tags: ['launch']}],
        title: 'In Progress',
        tone: 'blue',
      },
      {
        cards: [],
        title: 'Done',
        tone: 'emerald',
      },
    ],
  },
  movingCard: {
    card: {
      title: 'Publish launch film cutdown',
      tags: ['launch'],
    },
    motion: {
      from: 70,
      to: 170,
      fromLeft: 8,
      toLeft: 40,
      fromTop: 34,
      toTop: 24,
      fromRotation: -2,
      toRotation: 1,
    },
  },
};

export const threadsHeaderSearchState: ThreadsHeaderState = {
  ...boardShotState.header,
  searchKeyword: 'launch',
};

export const threadsHeaderFilterState: ThreadsHeaderState = {
  ...boardShotState.header,
  activeFilterCount: 2,
  filterPopover: {
    visible: true,
    rootOnly: true,
    showArchived: false,
    statuses: [
      {label: 'Active', selected: true, color: '#2563eb'},
      {label: 'Paused', color: '#a16207'},
      {label: 'Done', color: '#16a34a'},
    ],
    tags: [
      {label: 'launch', selected: true, color: '#7c3aed'},
      {label: 'video', color: '#0891b2'},
      {label: 'bug', color: '#dc2626'},
    ],
    chatStates: [
      {label: 'Has tools', selected: true, color: '#0d9488'},
      {label: 'Needs reply', color: '#64748b'},
    ],
  },
};

export const threadsHeaderArchiveState: ThreadsHeaderState = {
  ...boardShotState.header,
  showArchived: true,
};

export function boardViewForFrame(frame: number) {
  const motion = boardShotState.movingCard.motion;
  const progress = ease(frame, motion.from, motion.to);
  return {
    movingCardStyle: {
      left: `${mix(motion.fromLeft, motion.toLeft, progress)}%`,
      top: `${mix(motion.fromTop, motion.toTop, progress)}%`,
      transform: `rotate(${mix(motion.fromRotation, motion.toRotation, progress)}deg)`,
    },
  };
}

export function boardShotViewForFrame(frame: number): BoardShotView {
  const view = boardViewForFrame(frame);
  return {
    board: boardShotState.board,
    breadcrumbs: boardShotState.breadcrumbs,
    header: boardShotState.header,
    movingCard: {
      card: boardShotState.movingCard.card,
      style: view.movingCardStyle,
    },
  };
}
