export function Caret({frame, visible}: {frame: number; visible: boolean}) {
  if (!visible) return null;
  return <span style={{opacity: Math.sin(frame * 0.55) > 0 ? 1 : 0.15}}>_</span>;
}

