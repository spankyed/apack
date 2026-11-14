import {ease, mix} from '../state/timeline';
import {getCursorAsset} from '../assets/cursors/cursorRegistry';
import {createPortal} from 'react-dom';
import type {CursorAssetId, CursorThemeId} from '../assets/cursors/cursorRegistry';
import {clickPulseFrames, cursorPoint} from '../interaction/cursorTargets';
import type {CoordinateSpace, Point} from '../interaction/cursorTargets';

const defaultFadeFrames = 8;

type CursorProps = {
  click?: boolean;
  coordinateSpace?: CoordinateSpace;
  cursor?: CursorAssetId;
  end: number;
  fade?: boolean;
  frame: number;
  from: Point;
  scale?: number;
  start: number;
  theme?: CursorThemeId;
  to: Point;
};

export function Cursor({click = true, coordinateSpace = 'percent', cursor, end, fade = true, frame, from, scale = 1, start, theme, to}: CursorProps) {
  const asset = getCursorAsset({cursor, theme});
  const p = ease(frame, start, end);
  const [x, y] = cursorPoint(from, to, p, coordinateSpace);
  const opacity = fade ? cursorOpacityForFrame(frame, start, end) : 1;
  const clickAmount = click ? Math.sin(ease(frame, end - clickPulseFrames, end) * Math.PI) : 0;
  const width = 42 * scale;
  const height = width * (asset.height / asset.width);
  const hotspotX = (asset.hotspot[0] / asset.width) * width;
  const hotspotY = (asset.hotspot[1] / asset.height) * height;

  const element = (
    <div
      style={{
        position: typeof document !== 'undefined' ? 'fixed' : 'absolute',
        left: coordinateSpace === 'px' ? `${x}px` : `${x}%`,
        top: coordinateSpace === 'px' ? `${y}px` : `${y}%`,
        width,
        height,
        pointerEvents: 'none',
        opacity,
        transform: `translate(${-hotspotX}px, ${-hotspotY}px) scale(${1 - clickAmount * 0.055})`,
        transformOrigin: `${hotspotX}px ${hotspotY}px`,
        zIndex: 2147483647,
      }}
    >
      {clickAmount > 0 ? (
        <div
          style={{
            position: 'absolute',
            left: hotspotX,
            top: hotspotY,
            width: 18,
            height: 18,
            border: '1.5px solid rgb(255 255 255 / 0.82)',
            background: 'rgb(255 255 255 / 0.1)',
            borderRadius: 999,
            opacity: clickAmount * 0.58,
            transform: `translate(-50%, -50%) scale(${mix(0.48, 2.08, clickAmount)})`,
          }}
        />
      ) : null}
      <div
        style={{
          width: '100%',
          height: '100%',
          backgroundImage: `url("${asset.file}")`,
          backgroundPosition: 'center',
          backgroundRepeat: 'no-repeat',
          backgroundSize: 'contain',
          filter: 'drop-shadow(0 5px 8px rgb(0 0 0 / 0.62)) drop-shadow(0 1px 1px rgb(0 0 0 / 0.72))',
        }}
      />
    </div>
  );

  if (typeof document !== 'undefined') {
    return createPortal(element, document.body);
  }

  return element;
}

export function cursorOpacityForFrame(frame: number, start: number, end: number) {
  const fadeFrames = Math.min(defaultFadeFrames, Math.max(1, Math.floor((end - start) / 3)));
  return Math.min(
    ease(frame, start, start + fadeFrames),
    1 - ease(frame, end - fadeFrames, end),
  );
}

