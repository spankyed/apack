import type {NotesRightRailState, NoteTreeNodeState} from '../../agentbuddy-ui/notes/noteTypes';
import type {NoteImageBlockState} from '../../agentbuddy-ui/notes/NoteImageBlock';
import type {NotesHomeCardState} from '../../agentbuddy-ui/notes/NotesHomeSurface';
import type {ReferenceRefType} from '../../agentbuddy-ui/chat/referenceConfig';
import {launchFilmStory} from './launchStory';
import {revealText} from './typing';
import {createInteractionModel, type InteractionStep} from '../interaction/interactionTimeline';
import {percentTarget, type TargetRect} from '../interaction/cursorTargets';

// Notes pointer interactions — the single source of truth that drives both the
// scene's cursor and the press/active states below. Home and editor are
// separate cursor phases, so they have separate scripts.
export type NotesHomeTargetId = 'newNoteButton';
export type NotesEditorTargetId = 'editorBody' | 'rightRailTasklist' | 'taskListCurrentRow' | 'taskCheckbox';

export const notesHomeInteractionScript: InteractionStep<NotesHomeTargetId>[] = [
  {label: 'new-note', start: 118, end: 146, to: 'newNoteButton', fromViewport: [0.52, 0.52], toPoint: {anchor: [0.52, 0.5]}},
];
export const notesEditorInteractionScript: InteractionStep<NotesEditorTargetId>[] = [
  {label: 'open-tasklist', start: 50, end: 70, to: 'rightRailTasklist', from: 'editorBody'},
  {label: 'open-todo', start: 98, end: 122, to: 'taskListCurrentRow', from: 'rightRailTasklist'},
  {label: 'complete-todo', start: 126, end: 138, to: 'taskCheckbox', from: 'taskListCurrentRow'},
];
export const notesHomeInteractions = createInteractionModel(notesHomeInteractionScript);
export const notesEditorInteractions = createInteractionModel(notesEditorInteractionScript);

// The task panel's "receipt emails" row and its checkbox, derived from the real
// app-window box so the cursor lands on the actual row in every variant —
// viewport-percent targets drifted between the landscape and square windows and
// pointed several rows below the row that highlighted. Offsets are the panel's
// fixed chrome: icon sidebar (72), 250px panel, breadcrumb + panel header +
// list padding above the first row, and 36px rows.
export function notesTaskPanelTargets(
  windowBox: {height: number; left: number; top: number; width: number},
  viewport: {height: number; width: number},
): {taskCheckbox: TargetRect; taskListCurrentRow: TargetRect} {
  const SIDEBAR = 72;
  const PANEL_WIDTH = 250;
  const FIRST_ROW_CENTER = 105; // breadcrumb + panel header + list padding + half of the first row
  const ROW_PITCH = 36;
  const RECEIPT_ROW_INDEX = 2;  // Stripe webhooks, current, receipt emails
  const panelLeft = windowBox.left + SIDEBAR;
  const rowCenterY = windowBox.top + FIRST_ROW_CENTER + RECEIPT_ROW_INDEX * ROW_PITCH;
  const point = (x: number, y: number) => percentTarget((x / viewport.width) * 100, (y / viewport.height) * 100);
  return {
    taskCheckbox: point(panelLeft + PANEL_WIDTH - 18, rowCenterY),
    taskListCurrentRow: point(panelLeft + 70, rowCenterY),
  };
}

// The editor's start point and the right-rail "Tasklist" tree item, derived
// from the window box so they track the app window across variants instead of
// being pinned to viewport percentages. The right rail is the 368px column
// docked at the window's right edge (AppWindow grid: 72px | 1fr | 368px).
export function notesEditorChromeTargets(
  windowBox: {height: number; left: number; top: number; width: number},
  viewport: {height: number; width: number},
): {editorBody: TargetRect; rightRailTasklist: TargetRect} {
  const RAIL_WIDTH = 368;
  const railLeft = windowBox.left + windowBox.width - RAIL_WIDTH;
  const point = (x: number, y: number, w = 0, h = 0) =>
    percentTarget((x / viewport.width) * 100, (y / viewport.height) * 100, (w / viewport.width) * 100, (h / viewport.height) * 100);
  return {
    // Cursor start point, centered in the editor area (between sidebar and rail).
    editorBody: point(windowBox.left + windowBox.width * 0.52, windowBox.top + windowBox.height * 0.49),
    // The "Tasklist" item in the right-rail tree.
    rightRailTasklist: point(railLeft + 112, windowBox.top + 283),
  };
}

export type NotesTaskListPanelState = {
  activeId: string | null;
  items: NoteTreeNodeState[];
  showCompleted: boolean;
  title: {
    icon: string;
    text: string;
  };
};

export type NotesEditorLineView = {
  caretVisible?: boolean;
  id: string;
  references?: Array<{
    id: string;
    label: string;
    refType: ReferenceRefType;
    token: string;
  }>;
  text: string;
};

export type NotesShotView = {
  breadcrumbs: string[];
  editor: {
    afterLines: NotesEditorLineView[];
    beforeLines: NotesEditorLineView[];
    image?: NoteImageBlockState;
    title: {
      icon: string;
      text: string;
    };
  };
  home: {
    favorites: NotesHomeCardState[];
    greeting: string;
    newNotePressed?: boolean;
    recent: NotesHomeCardState[];
    searchQuery?: string;
    searchResults?: NotesHomeCardState[];
    showFavorites?: boolean;
    showRecent?: boolean;
    showSearch?: boolean;
  };
  rightRail: NotesRightRailState;
  taskList: NotesTaskListPanelState;
};

export const notesTaskListItems: NoteTreeNodeState[] = [
  {id: 'stripe-webhooks', title: 'Stripe webhooks', icon: '🔧', noteType: 'task'},
  {id: 'current', title: 'current', icon: '💳', noteType: 'task'},
  {id: 'receipt-emails', title: 'receipt emails', noteType: 'task'},
  {id: 'checkout-ui', title: 'checkout UI', noteType: 'task'},
  {id: 'discount-codes', title: 'discount codes', noteType: 'task'},
  {id: 'creator-payouts', title: 'creator payouts', noteType: 'task'},
  {id: 'product-variants', title: 'product variants', noteType: 'task'},
  {id: 'landing-page', title: 'landing page redesign', noteType: 'task', completed: true, muted: true},
  {id: 'pricing-tiers', title: 'pricing tiers', icon: '💰', noteType: 'task'},
  {id: 'analytics-dashboard', title: 'analytics dashboard', noteType: 'task'},
];

export const notesTaskListState: NotesTaskListPanelState = {
  activeId: 'current',
  items: notesTaskListItems,
  showCompleted: true,
  title: {icon: '📝', text: 'Tasklist'},
};

export const notesTaskListMenuState = {
  activeId: 'current',
  headerMenuOpen: true,
  items: notesTaskListItems,
  showCompleted: true,
  title: {icon: '📝', text: 'Tasklist'},
};

export const notesTaskListRowMenuState = {
  activeId: 'current',
  items: notesTaskListItems.map(item =>
    item.id === 'current'
      ? {
        ...item,
        favorite: true,
        hasCompletedChildren: true,
        hidingCompletedChildren: false,
        rowMenuOpen: true,
      }
      : item
  ),
  showCompleted: true,
  title: {icon: '📝', text: 'Tasklist'},
};

export const notesRailFavorites: NoteTreeNodeState[] = [
  {id: 'fav-current', icon: '💳', title: 'current', noteType: 'document'},
  {id: 'fav-api', icon: '🔌', title: 'api', noteType: 'document'},
  {id: 'fav-roadmap', icon: '🗺️', title: 'Roadmap', noteType: 'document'},
];

export const notesRailTree: NoteTreeNodeState[] = [
  {id: 'supafan', icon: '⚡', title: 'Supafan', noteType: 'document'},
  {id: 'payments', icon: '💳', title: 'Payments', noteType: 'document'},
  {id: 'tasklist', icon: '📝', title: 'Tasklist', noteType: 'tasklist'},
  {id: 'design', icon: '🎨', title: 'Design', noteType: 'document'},
];

export const notesRightRailState: NotesRightRailState = {
  activeId: 'tasklist',
  favorites: notesRailFavorites,
  favoritesExpanded: true,
  items: notesRailTree,
};

export const notesHomeState: NotesShotView['home'] = {
  greeting: 'Good afternoon',
  recent: [
    {id: 'recent-current', icon: '💳', title: 'current', noteType: 'document', updatedAt: 'just now', active: true},
    {id: 'recent-tasklist', icon: '📝', title: 'Tasklist', noteType: 'tasklist', updatedAt: '4m ago'},
    {id: 'recent-api', icon: '🔌', title: 'api', noteType: 'document', updatedAt: '18m ago'},
  ],
  favorites: [
    {id: 'fav-current', icon: '💳', title: 'current', noteType: 'document', updatedAt: 'just now'},
    {id: 'fav-roadmap', icon: '🗺️', title: 'Roadmap', noteType: 'document', updatedAt: 'today'},
    {id: 'fav-design', icon: '🎨', title: 'Design', noteType: 'document', updatedAt: 'yesterday'},
  ],
};

export const notesRightRailSearchState: NotesRightRailState = {
  ...notesRightRailState,
  search: {
    active: true,
    query: 'checkout',
  },
};

export const notesRightRailMenuState: NotesRightRailState = {
  ...notesRightRailState,
  createMenuOpen: true,
};

export const notesRightRailTrashState: NotesRightRailState = {
  ...notesRightRailState,
  trash: {
    visible: true,
    items: [
      {id: 'trash-old-plan', icon: '🧾', title: 'old checkout outline', noteType: 'document', deletedAge: '2d'},
      {id: 'trash-draft', icon: '📝', title: 'draft payout notes', noteType: 'document', deletedAge: '5d'},
    ],
  },
};

export const notesRightRailTrashActionsState: NotesRightRailState = {
  ...notesRightRailTrashState,
  trash: {
    ...notesRightRailTrashState.trash!,
    actionId: 'trash-draft',
  },
};

const newNoteCopy = {
  breadcrumbs: ['Notes', 'Supafan', 'Checkout Notes'],
  title: {icon: '📝', text: 'Checkout notes'},
  lines: [
    'Stripe webhook setup',
    'checkout flow in staging',
    'keep tasks nearby',
  ],
};

const tasklistOverviewCopy = {
  breadcrumbs: ['Notes', 'Supafan', 'Tasklist'],
  title: {icon: '📝', text: 'Tasklist'},
  beforeLines: [
    'Stripe webhooks',
    'current',
    'receipt emails',
    launchFilmStory.threads.addDiscountCodeSupport.title,
  ],
  afterLines: [
    'Checkout work stays by the note.',
  ],
};

const todoNoteCopy = {
  breadcrumbs: ['Notes', 'Supafan', 'Tasklist', 'receipt emails'],
  title: {icon: '', text: 'receipt emails'},
  beforeLines: [
    'Configure Resend transport',
    'Render order summary template',
    'Keep the linked checkout context visible',
  ],
  afterLines: [
    'Completed from panel.',
  ],
};

export function notesHomeViewForFrame(frame: number): NotesShotView['home'] {
  // Every section renders at once (like the real app on load); only the
  // greeting types in over the top. New Note press stays cursor-driven.
  const greeting = revealText(notesHomeState.greeting, frame, -4);
  const newNotePressed = notesHomeInteractions.pressed('newNoteButton', frame, {lead: 10, tail: 8});

  return {
    ...notesHomeState,
    greeting,
    newNotePressed,
    recent: notesHomeState.recent.map(note => ({...note, active: false, pressed: false})),
    showFavorites: true,
    showRecent: true,
    showSearch: true,
  };
}

export function notesEditorViewForFrame(frame: number): NotesShotView {
  // Press while the cursor clicks; the note/todo opens (active) right at the
  // click and completion lands immediately — all derived from the cursor.
  const tasklistPressed = notesEditorInteractions.pressed('rightRailTasklist', frame, {lead: 12, tail: 6});
  const tasklistActive = notesEditorInteractions.clicked('rightRailTasklist', frame, 6);
  const todoActive = notesEditorInteractions.clicked('taskListCurrentRow', frame, 0);
  const todoCompletePressed = notesEditorInteractions.pressed('taskCheckbox', frame, {lead: 4, tail: 6});
  const todoComplete = notesEditorInteractions.clicked('taskCheckbox', frame, 0);

  const taskList = notesTaskListForEditorFrame(frame);
  const rightRail: NotesRightRailState = {
    ...notesRightRailState,
    activeId: tasklistActive ? 'tasklist' : undefined,
    items: notesRightRailState.items.map(item => item.id === 'tasklist'
      ? {...item, pressed: tasklistPressed}
      : item
    ),
  };

  if (!tasklistActive) {
    return {
      breadcrumbs: newNoteCopy.breadcrumbs,
      editor: {
        afterLines: [],
        beforeLines: newNoteCopy.lines.map((text, index) => ({
          caretVisible: index === newNoteCopy.lines.length - 1 && frame < 70,
          id: `new-note-${index}`,
          // Lines type one after another, never simultaneously. Stagger
          // (24f) exceeds the longest line so reveals never overlap.
          text: revealText(text, frame, 6 + index * 24),
        })),
        title: {
          icon: newNoteCopy.title.icon,
          text: revealText(newNoteCopy.title.text, frame, 0),
        },
      },
      home: notesHomeState,
      rightRail,
      taskList,
    };
  }

  if (!todoActive) {
    return {
      breadcrumbs: tasklistOverviewCopy.breadcrumbs,
      editor: {
        afterLines: tasklistOverviewCopy.afterLines.map((text, index) => ({
          id: `overview-after-${index}`,
          text: revealText(text, frame, 88 + index * 10),
        })),
        beforeLines: tasklistOverviewCopy.beforeLines.map((text, index) => ({
          id: `overview-${index}`,
          text,
        })),
        title: tasklistOverviewCopy.title,
      },
      home: notesHomeState,
      rightRail,
      taskList,
    };
  }

  return {
    breadcrumbs: todoNoteCopy.breadcrumbs,
    editor: {
      afterLines: todoNoteCopy.afterLines.map((text, index) => ({
        id: `todo-after-${index}`,
        text: revealText(text, frame, 144 + index * 8),
      })),
      beforeLines: todoNoteCopy.beforeLines.map((text, index) => ({
        caretVisible: index === todoNoteCopy.beforeLines.length - 1 && !todoComplete,
        id: `todo-${index}`,
        text,
      })),
      title: todoNoteCopy.title,
    },
    home: notesHomeState,
    rightRail,
    taskList: {
      ...taskList,
      activeId: 'receipt-emails',
      items: taskList.items.map(item => item.id === 'receipt-emails'
        ? {...item, checkboxPressed: todoCompletePressed, completed: todoComplete, muted: todoComplete}
        : item
      ),
    },
  };
}

function notesTaskListForEditorFrame(frame: number): NotesTaskListPanelState {
  const tasklistActive = notesEditorInteractions.clicked('rightRailTasklist', frame, 6);
  const todoActive = notesEditorInteractions.clicked('taskListCurrentRow', frame, 0);
  const todoPressed = notesEditorInteractions.pressed('taskListCurrentRow', frame, {lead: 8, tail: 6});
  const todoCompletePressed = notesEditorInteractions.pressed('taskCheckbox', frame, {lead: 4, tail: 6});
  const todoComplete = notesEditorInteractions.clicked('taskCheckbox', frame, 0);
  // receipt-emails becomes the selected row the moment it is engaged (pressed or
  // clicked) — which also de-activates the panel header, so only one row reads
  // as selected at a time, and never before the cursor clicks it.
  const receiptSelected = tasklistActive && (todoPressed || todoActive);

  return {
    ...notesTaskListState,
    activeId: receiptSelected ? 'receipt-emails' : null,
    items: notesTaskListItems.map(item => {
      if (item.id === 'receipt-emails') {
        return {
          ...item,
          checkboxPressed: todoCompletePressed,
          completed: todoComplete,
          muted: todoComplete,
          pressed: todoPressed || todoCompletePressed,
        };
      }
      return item;
    }),
  };
}
