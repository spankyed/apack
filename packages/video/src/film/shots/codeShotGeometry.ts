import {percentTarget, type TargetRect} from '../interaction/cursorTargets';

// The floating code feature panel's live box, centered (translate(-50%,-50%)) at
// {left, top} with {width, height}. Targets are derived from this so the cursor
// tracks the panel as it docks AND across the landscape/square layouts, instead
// of being pinned to viewport percentages that only line up in landscape.
export type CodePanelRect = {height: number; left: number; top: number; width: number};

export type CodeCursorLayout = {
  windowStyle: {
    height?: number | string;
    left?: number | string;
    top?: number | string;
    width?: number | string;
  };
};

// Each target is an offset from one panel edge. The anchor is chosen to match
// how the element sits in the panel: toolbar/top-row controls hug the RIGHT
// edge, full-width content/buttons sit on the CENTER line, the terminal toggle
// hugs the LEFT edge, and bottom controls anchor to the BOTTOM edge. Offsets are
// back-calculated from the original landscape viewport-percent targets evaluated
// at the panel box for the frame each target is the cursor's destination, so the
// landscape render is pixel-identical to the previous behavior.
//
// dx/dy are panel-relative pixels; vertical anchor is the panel TOP unless the
// element lives near the panel bottom.
const PANEL_TARGETS: Record<string, {anchorX: 'left' | 'center' | 'right'; anchorY: 'top' | 'bottom'; dx: number; dy: number}> = {
  changedFiles: {anchorX: 'center', anchorY: 'top', dx: 89, dy: 399},
  commitArea: {anchorX: 'center', anchorY: 'top', dx: 103, dy: 304},
  commitButton: {anchorX: 'center', anchorY: 'top', dx: 45, dy: 408},
  createPrPrimary: {anchorX: 'center', anchorY: 'bottom', dx: 103, dy: -54},
  createPullRequestButton: {anchorX: 'right', anchorY: 'top', dx: -18, dy: 169},
  prDescription: {anchorX: 'center', anchorY: 'top', dx: 31, dy: 313},
  publishButton: {anchorX: 'right', anchorY: 'top', dx: -54, dy: 115},
  pullRequestTab: {anchorX: 'right', anchorY: 'top', dx: -26, dy: 70},
  // sourceControlHeader is the panel-title toolbar; its destination frame is
  // dock=0, so anchoring to the live panel top reproduces the centered position.
  sourceControlHeader: {anchorX: 'right', anchorY: 'top', dx: -42, dy: 100},
  sourceControlTab: {anchorX: 'right', anchorY: 'top', dx: -83, dy: 106},
  terminalToggle: {anchorX: 'left', anchorY: 'bottom', dx: 88, dy: -81},
  worktreeSection: {anchorX: 'center', anchorY: 'bottom', dx: 132, dy: -72},
};

function panelEdges(panel: CodePanelRect) {
  return {
    bottom: panel.top + panel.height / 2,
    center: panel.left,
    left: panel.left - panel.width / 2,
    right: panel.left + panel.width / 2,
    top: panel.top - panel.height / 2,
  };
}

export function codeCursorTargetsFromLayout(
  panel: CodePanelRect,
  layout: CodeCursorLayout,
  width: number,
  height: number,
): Record<string, TargetRect> {
  const edges = panelEdges(panel);
  const point = (x: number, y: number) => percentTarget((x / width) * 100, (y / height) * 100);

  const targets: Record<string, TargetRect> = {};
  for (const [id, {anchorX, anchorY, dx, dy}] of Object.entries(PANEL_TARGETS)) {
    const x = edges[anchorX] + dx;
    const y = (anchorY === 'top' ? edges.top : edges.bottom) + dy;
    targets[id] = point(x, y);
  }

  // stageCenter is the cursor's start point for the first move, lands at dock=0
  // when the panel is still centered on screen. Anchored to the panel (center /
  // bottom) so it follows the panel across variants; it is only a start point,
  // never a click target, so it just needs to sit beside the centered panel.
  // (layout retained for parity with the panel-relative pattern.)
  void layout;
  targets.stageCenter = point(edges.center - 14, edges.bottom - 208);

  return targets;
}
