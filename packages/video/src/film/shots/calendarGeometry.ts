import type {TargetRect} from '../interaction/cursorTargets';
import {calendarHourPx} from '../../agentbuddy-ui/calendar/calendarTypes';
import {calendarDayScrollOffsetPx} from '../state/calendar';

export type CalendarCursorLayout = {
  windowStyle: {
    height?: number | string;
    left?: number | string;
    top?: number | string;
    width?: number | string;
  };
};

// Layout math mirrors AppWindow chrome + CalendarSurface.module.css.
const toolbarWidth = 72;
const chromeHeaderHeight = 42;
const calendarHeaderHeight = 59; // 12px padding ×2 + 34px Today/New Event row + 1px border
const weekdayRowHeight = 29; // 6px padding ×2 + 16px line + 1px border
const gutterWidth = 64;
const todayCellColumn = 6; // Sat Jun 27 in the Sunday-first 42-cell grid (index 27)
const todayCellRow = 3;

type SurfaceRect = {height: number; left: number; top: number; width: number};

function surfaceRect(layout: CalendarCursorLayout, width: number, height: number): SurfaceRect {
  const windowLeft = Number(layout.windowStyle.left) || 0;
  const windowTop = Number(layout.windowStyle.top) || 0;
  const windowWidth = Number(layout.windowStyle.width) || width;
  const windowHeight = Number(layout.windowStyle.height) || height;
  return {
    height: windowHeight - chromeHeaderHeight,
    left: windowLeft + toolbarWidth,
    top: windowTop + chromeHeaderHeight,
    width: windowWidth - toolbarWidth,
  };
}

export function calendarDayNumberTarget(layout: CalendarCursorLayout, width: number, height: number): TargetRect {
  const surface = surfaceRect(layout, width, height);
  const cellWidth = surface.width / 7;
  const gridTop = surface.top + calendarHeaderHeight + weekdayRowHeight;
  const cellHeight = (surface.height - calendarHeaderHeight - weekdayRowHeight) / 6;
  const pillWidth = 28;
  const pillHeight = 20;
  return {
    // The day-number pill sits in the top-right of the cell; nudge a touch up
    // and left so the cursor lands on its centre rather than its bottom-right edge.
    left: surface.left + todayCellColumn * cellWidth + cellWidth - 10 - pillWidth,
    top: gridTop + todayCellRow * cellHeight - 6,
    width: pillWidth,
    height: pillHeight,
  };
}

export function calendarTenAmSlotTarget(layout: CalendarCursorLayout, width: number, height: number): TargetRect {
  const surface = surfaceRect(layout, width, height);
  const trackTop = surface.top + calendarHeaderHeight - calendarDayScrollOffsetPx;
  return {
    left: surface.left + gutterWidth,
    top: trackTop + 10 * calendarHourPx,
    width: surface.width - gutterWidth,
    height: calendarHourPx,
  };
}

export function calendarDialogSaveTarget(layout: CalendarCursorLayout, width: number, height: number): TargetRect {
  const surface = surfaceRect(layout, width, height);
  // The event dialog is centered horizontally (90%, max 480px). Its Save button
  // sits at the bottom-right of the panel; the panel's rendered vertical
  // position is NOT a clean center (the prior panelHeight=430 centered guess
  // put the target ~200px too high). The Save button's centre measures to a
  // fixed offset below the surface top in BOTH variants (the panel's content
  // height is identical), so anchor it there.
  const panelWidth = Math.min(480, surface.width * 0.9);
  const panelLeft = surface.left + (surface.width - panelWidth) / 2;
  const saveWidth = 52;
  const saveHeight = 32;
  const saveCenterY = surface.top + 775;
  return {
    left: panelLeft + panelWidth - 24 - saveWidth,
    top: saveCenterY - saveHeight / 2,
    width: saveWidth,
    height: saveHeight,
  };
}
