import {percentTarget, type TargetRect} from '../interaction/cursorTargets';

export type CodeCursorLayout = {
  windowStyle: {
    height?: number | string;
    left?: number | string;
    top?: number | string;
    width?: number | string;
  };
};

export type CodeCursorTargetId =
  | 'commitButton'
  | 'createPrButton'
  | 'generateCommitButton'
  | 'mergePrButton'
  | 'prTabIcon'
  | 'pushButton'
  | 'sourceControlIcon'
  | 'stageCenter';

// The code-review feature panel is RIGHT-DOCKED and flush to the window's right
// edge with a fixed width (430 landscape, 360 square). Deriving the cursor
// targets from the real app-window box keeps the cursor on the actual elements
// in both variants — the landscape and square windows are inset by different
// margins, so a single viewport-percent target lands on the element in one
// variant and drifts in the other.
//
// Offsets below are the panel's fixed pixel chrome, calibrated against the
// landscape variant (window {32,32,1376,836}) so its rendered positions are
// pixel-identical to the previous hand-tuned percent targets:
//   - 42px breadcrumb chrome header above the panel
//   - 42px "Pull Request" panel header, then a 40px right-aligned icon row
//   - right-aligned toolbar icons / Publish / Create-PR anchor to panelRight
//   - bottom action-bar buttons (create PR, merge PR) anchor to the window bottom
//   - the PR description field sits mid-panel
const PANEL_TOP_CHROME = 42; // breadcrumb header above the feature panel

// Right-aligned toolbar icons (commit = source control, pr = pull request) sit
// in the 40px icon row; X measured leftward from the panel's right edge.
const SOURCE_CONTROL_ICON_FROM_RIGHT = 163.8;
const PR_TAB_ICON_FROM_RIGHT = 132.2;
const ICON_ROW_CENTER_FROM_PANEL_TOP = 62.8; // panel header (42) + half the icon row (20)

// Source-control (commit) panel elements. The push/"publish" icon (up-arrow +
// commit-count badge) and the generate-message sparkle are right-aligned in the
// branch + commit-message rows; the green Commit button spans the panel width.
const PUSH_FROM_RIGHT = 23;
const PUSH_FROM_PANEL_TOP = 106;
const GENERATE_FROM_RIGHT = 30;
const GENERATE_FROM_PANEL_TOP = 155;
const COMMIT_BUTTON_FROM_PANEL_TOP = 300; // centered horizontally in the panel

// PR-panel bottom action bar. Both the create-mode "Create PR" button and the
// details-mode "Merge" button are LEFT-anchored in the action bar (the prior
// right-edge anchor only matched the 430px landscape panel and drifted in the
// 360px square panel). Y is measured up from the window bottom.
const CREATE_PR_BUTTON_FROM_LEFT = 156;
const CREATE_PR_BUTTON_FROM_BOTTOM = 75;
const MERGE_PR_BUTTON_FROM_LEFT = 56;
const MERGE_PR_BUTTON_FROM_BOTTOM = 70;

type WindowBox = {height: number; left: number; top: number; width: number};

function windowBox(layout: CodeCursorLayout, width: number, height: number): WindowBox {
  return {
    height: Number(layout.windowStyle.height) || height,
    left: Number(layout.windowStyle.left) || 0,
    top: Number(layout.windowStyle.top) || 0,
    width: Number(layout.windowStyle.width) || width,
  };
}

export function codePanelRect(
  layout: CodeCursorLayout,
  variant: 'landscape' | 'square' | undefined,
  width: number,
  height: number,
): {bottom: number; left: number; right: number; top: number; width: number} {
  const box = windowBox(layout, width, height);
  const panelWidth = variant === 'square' ? 360 : 430;
  const right = box.left + box.width;
  return {
    bottom: box.top + box.height,
    left: right - panelWidth,
    right,
    top: box.top + PANEL_TOP_CHROME,
    width: panelWidth,
  };
}

export function codeCursorTargets(
  layout: CodeCursorLayout,
  variant: 'landscape' | 'square' | undefined,
  width: number,
  height: number,
): Record<CodeCursorTargetId, TargetRect> {
  const box = windowBox(layout, width, height);
  const panel = codePanelRect(layout, variant, width, height);
  const panelWidth = panel.width;
  // Cursor starts in the blank left stage, centered in the surface left of the panel.
  const stageCenterX = box.left + (box.width - panelWidth) / 2;
  const stageCenterY = box.top + box.height / 2;
  // Targets are points; widths/heights are small hit boxes matching the prior
  // percent targets so the click ripple covers the element.
  const point = (x: number, y: number, w: number, h: number) =>
    percentTarget(
      ((x - w / 2) / width) * 100,
      ((y - h / 2) / height) * 100,
      (w / width) * 100,
      (h / height) * 100,
    );

  return {
    commitButton: point(panel.left + panelWidth / 2, panel.top + COMMIT_BUTTON_FROM_PANEL_TOP, 120, 27),
    createPrButton: point(panel.left + CREATE_PR_BUTTON_FROM_LEFT, panel.bottom - CREATE_PR_BUTTON_FROM_BOTTOM, 58, 27),
    generateCommitButton: point(panel.right - GENERATE_FROM_RIGHT, panel.top + GENERATE_FROM_PANEL_TOP, 24, 24),
    mergePrButton: point(panel.left + MERGE_PR_BUTTON_FROM_LEFT, panel.bottom - MERGE_PR_BUTTON_FROM_BOTTOM, 58, 27),
    prTabIcon: point(panel.right - PR_TAB_ICON_FROM_RIGHT, panel.top + ICON_ROW_CENTER_FROM_PANEL_TOP, 40, 27),
    pushButton: point(panel.right - PUSH_FROM_RIGHT, panel.top + PUSH_FROM_PANEL_TOP, 28, 24),
    sourceControlIcon: point(panel.right - SOURCE_CONTROL_ICON_FROM_RIGHT, panel.top + ICON_ROW_CENTER_FROM_PANEL_TOP, 40, 27),
    stageCenter: point(stageCenterX, stageCenterY, 86, 54),
  };
}
