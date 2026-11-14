import type {TargetRect} from '../interaction/cursorTargets';

export type NotesHomeCursorLayout = {
  windowStyle: {
    left?: number | string;
    top?: number | string;
    width?: number | string;
  };
};

export function notesHomeNewNoteButtonTarget(
  layout: NotesHomeCursorLayout,
  width: number,
): TargetRect {
  const windowLeft = Number(layout.windowStyle.left) || 0;
  const windowTop = Number(layout.windowStyle.top) || 0;
  const windowWidth = Number(layout.windowStyle.width) || width;
  const toolbarWidth = 72;
  const headerHeight = 42;
  const surfaceLeft = windowLeft + toolbarWidth;
  const surfaceTop = windowTop + headerHeight;
  const surfaceWidth = windowWidth - toolbarWidth;
  const contentWidth = Math.min(672, surfaceWidth - 48);
  const contentLeft = surfaceLeft + (surfaceWidth - contentWidth) / 2;
  const searchRowTop = surfaceTop + 56 + 36 + 24;
  const newNoteButtonWidth = 106;
  const newNoteButtonHeight = 34;
  return {
    left: contentLeft + contentWidth - newNoteButtonWidth,
    top: searchRowTop,
    width: newNoteButtonWidth,
    height: newNoteButtonHeight,
  };
}
