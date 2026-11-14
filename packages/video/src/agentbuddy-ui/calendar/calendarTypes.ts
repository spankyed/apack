// Mirrors packages/renderer/src/plugins/calendar/ (state.ts + components).

export type CalendarChipState = {
  allDay?: boolean;
  id: string;
  /** Start-time prefix, e.g. "10:00 AM". Omitted for all-day chips. */
  time?: string;
  title: string;
};

export type CalendarMonthCellState = {
  chips: CalendarChipState[];
  day: number;
  inMonth: boolean;
  isToday?: boolean;
  /** Overflow rows collapsed into the "N more events…" line. */
  moreCount?: number;
  /** Hover affordance on the day-number pill (cursor beats). */
  numberHover?: boolean;
};

export type CalendarMonthState = {
  /** 42 cells, Sunday-first, like MonthGrid.vue. */
  cells: CalendarMonthCellState[];
};

export type CalendarDayBlockState = {
  heightPx: number;
  id: string;
  /** Percent offsets within the track (overlap columns). */
  leftPct: number;
  /** 0..1 enter progress for newly created events. */
  opacity?: number;
  pressed?: boolean;
  timeLabel: string;
  title: string;
  topPx: number;
  widthPct: number;
};

export type CalendarDayState = {
  allDayChips: CalendarChipState[];
  blocks: CalendarDayBlockState[];
  /** Red now-indicator offset inside the 24h track; null hides it. */
  nowLineTopPx?: number | null;
  /** Simulated scroll position of the hour grid. */
  scrollOffsetPx?: number;
};

export type CalendarDialogState = {
  allDay: boolean;
  caretVisible?: boolean;
  endValue: string;
  mode: 'create' | 'edit';
  notes: string;
  /** 0..1 enter progress (opacity + slight scale). */
  opacity?: number;
  saveHover?: boolean;
  startValue: string;
  title: string;
};

export type CalendarPickerMonthCell = {
  isCurrent?: boolean;
  label: string;
  selected?: boolean;
};

export type CalendarPickerDayCell = {
  day: number;
  inMonth: boolean;
  isSelected?: boolean;
  isToday?: boolean;
};

export type CalendarPickerState =
  | {headerLabel: string; mode: 'month'; months: CalendarPickerMonthCell[]}
  | {cells: CalendarPickerDayCell[]; headerLabel: string; mode: 'day'};

export type CalendarSurfaceState = {
  day?: CalendarDayState;
  dialog?: CalendarDialogState | null;
  /** Header label: "June 2026" (month) or "Saturday, June 27, 2026" (day). */
  headerLabel: string;
  labelHover?: boolean;
  month?: CalendarMonthState;
  newEventHover?: boolean;
  picker?: CalendarPickerState | null;
  todayHover?: boolean;
  view: 'day' | 'month';
};

export const calendarHourPx = 48;

export const calendarWeekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const calendarPickerWeekdays = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
