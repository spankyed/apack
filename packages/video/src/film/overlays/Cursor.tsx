import {ease, mix} from '../state/timeline';

type CursorProps = {
  end: number;
  frame: number;
  from: [number, number];
  start: number;
  to: [number, number];
};

export function Cursor({end, frame, from, start, to}: CursorProps) {
  const p = ease(frame, start, end);
  const curve = Math.sin(p * Math.PI) * 18;
  return (
    <div
      style={{
        position: 'absolute',
        left: `${mix(from[0], to[0], p)}%`,
        top: `${mix(from[1], to[1], p)}%`,
        width: 0,
        height: 0,
        borderLeft: '8px solid white',
        borderBottom: '20px solid transparent',
        filter: 'drop-shadow(0 8px 14px rgba(0,0,0,.7))',
        transform: `translate(${curve}px, ${curve * -0.25}px)`,
      }}
    />
  );
}
