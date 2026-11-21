import {ease, mix} from '../state/timeline';

export type Point = [number, number];

export type CoordinateSpace = 'percent' | 'px';

// Frames the click ripple spans before the cursor lands (must match Cursor.tsx).
export const clickPulseFrames = 7;

// The EXACT position the cursor sprite is drawn at — a bend Bézier from→to,
// shared by the Cursor renderer and the interaction model so hover/press are
// computed from the same pixels the viewer sees, never an approximation.
export function cursorPoint(from: Point, to: Point, progress: number, coordinateSpace: CoordinateSpace): Point {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const distance = Math.hypot(dx, dy);
  const bend = coordinateSpace === 'px'
    ? Math.min(42, Math.max(14, distance * 0.1))
    : Math.min(5.2, Math.max(1.5, distance * 0.1));
  const length = Math.max(distance, 0.0001);
  const side = dx + dy >= 0 ? 1 : -1;
  const controlA: Point = [
    mix(from[0], to[0], 0.34) + (-dy / length) * bend * side,
    mix(from[1], to[1], 0.32) + (dx / length) * bend * side,
  ];
  const controlB: Point = [
    mix(from[0], to[0], 0.76) + (-dy / length) * bend * side,
    mix(from[1], to[1], 0.72) + (dx / length) * bend * side,
  ];
  const inv = 1 - progress;
  return [
    inv ** 3 * from[0] + 3 * inv ** 2 * progress * controlA[0] + 3 * inv * progress ** 2 * controlB[0] + progress ** 3 * to[0],
    inv ** 3 * from[1] + 3 * inv ** 2 * progress * controlA[1] + 3 * inv * progress ** 2 * controlB[1] + progress ** 3 * to[1],
  ];
}

// The click-ripple amount the cursor draws for a move (0..1), > 0 while clicking.
export function cursorClickAmount(path: {click?: boolean; end: number; start: number}, frame: number): number {
  if (path.click === false) return 0;
  return Math.sin(ease(frame, path.end - clickPulseFrames, path.end) * Math.PI);
}

// The cursor sprite position for a resolved path at a frame.
export function cursorPositionForPath(path: CursorPath, frame: number): Point {
  return cursorPoint(path.from, path.to, ease(frame, path.start, path.end), path.coordinateSpace ?? 'percent');
}

export function pointInRect(point: Point, rect: TargetRect): boolean {
  return point[0] >= rect.left && point[0] <= rect.left + rect.width
    && point[1] >= rect.top && point[1] <= rect.top + rect.height;
}

export type TargetRect = {
  height: number;
  left: number;
  top: number;
  width: number;
};

export type TargetPointOptions = {
  /**
   * 0..1 position inside the rect. Defaults to center.
   */
  anchor?: Point;
  /**
   * Coordinate-space nudge after anchor resolution.
   */
  offset?: Point;
};

export type CursorPath = {
  click?: boolean;
  coordinateSpace?: CoordinateSpace;
  end: number;
  fade?: boolean;
  from: Point;
  start: number;
  to: Point;
};

export type TargetedCursorMove<TargetId extends string> = {
  click?: boolean;
  end: number;
  from: Point | TargetId;
  fromPoint?: TargetPointOptions;
  start: number;
  to: Point | TargetId;
  toPoint?: TargetPointOptions;
};

export type CursorTimelineMove<TargetId extends string> = TargetedCursorMove<TargetId> & {
  holdUntilNext?: boolean;
};

export function percentTarget(left: number, top: number, width = 0, height = 0): TargetRect {
  return {height, left, top, width};
}

export function viewportPoint(width: number, height: number, x: number, y: number): Point {
  return [width * x, height * y];
}

export function targetPoint(rect: TargetRect, options: TargetPointOptions = {}): Point {
  const [anchorX, anchorY] = options.anchor ?? [0.5, 0.5];
  const [offsetX, offsetY] = options.offset ?? [0, 0];
  return [
    rect.left + rect.width * anchorX + offsetX,
    rect.top + rect.height * anchorY + offsetY,
  ];
}

export function cursorMove<TargetId extends string>(
  targets: Record<TargetId, TargetRect>,
  move: TargetedCursorMove<TargetId>,
  coordinateSpace: CoordinateSpace = 'px',
): CursorPath {
  return {
    click: move.click,
    coordinateSpace,
    end: move.end,
    from: resolvePoint(targets, move.from, move.fromPoint),
    start: move.start,
    to: resolvePoint(targets, move.to, move.toPoint),
  };
}

export function cursorTimeline<TargetId extends string>(
  targets: Record<TargetId, TargetRect>,
  moves: Array<CursorTimelineMove<TargetId>>,
  frame: number,
  coordinateSpace: CoordinateSpace = 'px',
): CursorPath | null {
  const resolvedMoves = moves.map(move => cursorMove(targets, move, coordinateSpace));
  const activeIndex = resolvedMoves.findIndex(move => frame >= move.start && frame < move.end);
  if (activeIndex >= 0) {
    return {
      ...resolvedMoves[activeIndex],
      fade: false,
    };
  }

  for (let index = 0; index < resolvedMoves.length - 1; index += 1) {
    const current = resolvedMoves[index];
    const next = resolvedMoves[index + 1];
    if (frame >= current.end && frame < next.start && moves[index].holdUntilNext !== false) {
      return {
        click: false,
        coordinateSpace,
        end: next.start,
        fade: false,
        from: current.to,
        start: current.end,
        to: current.to,
      };
    }
  }

  return null;
}

export function targetDebugOverlay<TargetId extends string>(
  targets: Record<TargetId, TargetRect>,
) {
  return Object.entries(targets).map(([id, rect]) => ({id, rect: rect as TargetRect}));
}

function resolvePoint<TargetId extends string>(
  targets: Record<TargetId, TargetRect>,
  pointOrTarget: Point | TargetId,
  options?: TargetPointOptions,
): Point {
  if (Array.isArray(pointOrTarget)) return pointOrTarget;
  return targetPoint(targets[pointOrTarget], options);
}
