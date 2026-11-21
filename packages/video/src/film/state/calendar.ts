import type {
  CalendarChipState,
  CalendarDayState,
  CalendarDialogState,
  CalendarMonthCellState,
  CalendarSurfaceState,
} from '../../agentbuddy-ui/calendar';
import {launchFilmStory} from './launchStory';
import {ease} from './timeline';
import {revealText} from './typing';

const story = launchFilmStory.calendar;

// June 2026 (Sunday-first 42-cell grid): May 31, Jun 1-30, Jul 1-11.
// "Today" is launch day, Saturday Jun 27.
const todayDay = 27;
const pxPerMin = 48 / 60;

// Source-frame beats for the calendar shot. Geometry targets, the shot's
// cursor timeline, and the film-action audit all read from this table.
export const calendarBeats = {
  monthSettle: 10,
  dayNumberMoveStart: 56,
  dayNumberMoveEnd: 76,
  dayOpen: 80,
  dayOpenSettled: 92,
  slotMoveStart: 104,
  slotMoveEnd: 122,
  dialogOpen: 126,
  dialogSettled: 134,
  typingStart: 142,
  typingEnd: 186,
  saveMoveStart: 194,
  saveMoveEnd: 210,
  dialogClose: 214,
  blockIn: 218,
  blockInDone: 230,
  holdEnd: 270,
} as const;

const seededChips: Record<number, CalendarChipState[]> = {
  [story.seededEvents.deployChecklist.day]: [
    {id: 'ev-deploy-checklist', time: story.seededEvents.deployChecklist.time, title: story.seededEvents.deployChecklist.title},
  ],
  [story.seededEvents.betaFreeze.day]: [
    {allDay: true, id: 'ev-beta-freeze', title: story.seededEvents.betaFreeze.title},
  ],
  [story.seededEvents.stripeReview.day]: [
    {id: 'ev-stripe-review', time: story.seededEvents.stripeReview.time, title: story.seededEvents.stripeReview.title},
  ],
};

function monthCells(frame: number): CalendarMonthCellState[] {
  const numberHover = frame >= calendarBeats.dayNumberMoveEnd - 6 && frame < calendarBeats.dayOpen;

  return Array.from({length: 42}, (_, index) => {
    // index 0 = May 31; 1..30 = June; 31..41 = July 1-11.
    const inMonth = index >= 1 && index <= 30;
    const day = index === 0 ? 31 : inMonth ? index : index - 30;

    return {
      chips: inMonth ? seededChips[day] ?? [] : [],
      day,
      inMonth,
      isToday: inMonth && day === todayDay,
      numberHover: numberHover && inMonth && day === todayDay ? true : undefined,
    };
  });
}

// The viewed day (Jun 27) has no events before the launch event is created,
// so the app scrolls to 8 AM: (8h * 60 - 15) * pxPerMin.
export const calendarDayScrollOffsetPx = Math.round((8 * 60 - 15) * pxPerMin);

function dayState(frame: number): CalendarDayState {
  const blockEnter = ease(frame, calendarBeats.blockIn, calendarBeats.blockInDone);

  return {
    allDayChips: [],
    blocks: blockEnter > 0
      ? [
          {
            heightPx: 60 * pxPerMin, // 10:00 – 11:00 AM
            id: 'ev-launch-checkout',
            leftPct: 0,
            opacity: blockEnter,
            timeLabel: story.launchEvent.timeLabel,
            title: story.launchEvent.title,
            topPx: 10 * 60 * pxPerMin,
            widthPct: 100,
          },
        ]
      : [],
    // 9:12 AM on launch morning.
    nowLineTopPx: Math.round((9 * 60 + 12) * pxPerMin),
    scrollOffsetPx: calendarDayScrollOffsetPx,
  };
}

function dialogState(frame: number): CalendarDialogState | null {
  if (frame < calendarBeats.dialogOpen || frame >= calendarBeats.dialogClose) return null;

  const enter = ease(frame, calendarBeats.dialogOpen, calendarBeats.dialogSettled);
  const exit = ease(frame, calendarBeats.dialogClose - 6, calendarBeats.dialogClose);
  const title = revealText(story.launchEvent.title, frame, calendarBeats.typingStart);

  return {
    allDay: false,
    caretVisible: frame >= calendarBeats.dialogSettled && frame < calendarBeats.saveMoveEnd,
    endValue: `06/27/2026 ${story.launchEvent.end}`,
    mode: 'create',
    notes: '',
    opacity: Math.min(enter, 1 - exit),
    saveHover: frame >= calendarBeats.saveMoveEnd - 4,
    startValue: `06/27/2026 ${story.launchEvent.start}`,
    title,
  };
}

export function calendarViewForFrame(frame: number): CalendarSurfaceState {
  const inDayView = frame >= calendarBeats.dayOpen;

  if (!inDayView) {
    return {
      headerLabel: story.monthLabel,
      month: {cells: monthCells(frame)},
      view: 'month',
    };
  }

  return {
    day: dayState(frame),
    dialog: dialogState(frame),
    headerLabel: story.dayLabel,
    view: 'day',
  };
}

export function calendarBreadcrumbsForFrame(frame: number): string[] {
  return frame >= calendarBeats.dayOpen ? ['Calendar', story.dayBreadcrumb] : ['Calendar'];
}

// Static states for the Remotion studio demos.
export const calendarMonthDemoState: CalendarSurfaceState = calendarViewForFrame(0);

export const calendarDayDemoState: CalendarSurfaceState = calendarViewForFrame(calendarBeats.holdEnd - 1);

export const calendarDialogDemoState: CalendarSurfaceState = {
  ...calendarViewForFrame(calendarBeats.typingEnd),
  dialog: {
    allDay: false,
    caretVisible: true,
    endValue: `06/27/2026 ${story.launchEvent.end}`,
    mode: 'create',
    notes: '',
    opacity: 1,
    startValue: `06/27/2026 ${story.launchEvent.start}`,
    title: story.launchEvent.title,
  },
};

export const calendarPickerDemoState: CalendarSurfaceState = {
  ...calendarViewForFrame(0),
  labelHover: true,
  picker: {
    headerLabel: '2026',
    mode: 'month',
    months: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'].map((label, index) => ({
      isCurrent: index === 5,
      label,
      selected: index === 5,
    })),
  },
};

export const calendarDayPickerDemoState: CalendarSurfaceState = {
  ...calendarViewForFrame(calendarBeats.holdEnd - 1),
  dialog: null,
  labelHover: true,
  picker: {
    cells: Array.from({length: 42}, (_, index) => {
      const inMonth = index >= 1 && index <= 30;
      const day = index === 0 ? 31 : inMonth ? index : index - 30;
      return {
        day,
        inMonth,
        isSelected: inMonth && day === todayDay,
        isToday: false,
      };
    }),
    headerLabel: 'June 2026',
    mode: 'day',
  },
};
