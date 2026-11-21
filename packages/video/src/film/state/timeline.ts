export type ShotId = 'notes' | 'chat' | 'board' | 'code' | 'workflow' | 'final';

export type FilmShot = {
  captionAlign?: 'left' | 'right';
  duration: number;
  id: ShotId;
  title?: string;
};

export type FilmCaptionView = {
  alignRight: boolean;
  opacity: number;
  title: string;
  y: number;
};

export const shots: FilmShot[] = [
  {id: 'notes', title: 'Memory stays connected.', duration: 270},
  {id: 'chat', title: 'Conversation becomes work.', duration: 330},
  {id: 'board', title: 'Threads become execution.', duration: 240},
  {id: 'code', title: 'Ship from the same surface.', captionAlign: 'right', duration: 270},
  {id: 'workflow', title: 'Automate the system around you.', captionAlign: 'right', duration: 330},
  {id: 'final', duration: 300},
];

export const totalFrames = shots.reduce((sum, shot) => sum + shot.duration, 0);

export function filmProgressForFrame(frame: number) {
  return frame / Math.max(1, totalFrames - 1);
}

export function shotAtFrame(frame: number) {
  let cursor = 0;
  for (const shot of shots) {
    const end = cursor + shot.duration;
    if (frame >= cursor && frame < end) return shot;
    cursor = end;
  }
  return shots[shots.length - 1];
}

export function captionViewForFrame(shot: FilmShot, frame: number): FilmCaptionView | null {
  if (!shot.title) return null;
  return {
    alignRight: shot.captionAlign === 'right',
    opacity: Math.min(
      linearClamp(frame, 10, 34, 0, 1),
      linearClamp(frame, shot.duration - 46, shot.duration - 12, 1, 0),
    ),
    title: shot.title,
    y: linearClamp(frame, 0, 34, 20, 0),
  };
}

function linearClamp(local: number, from: number, to: number, outFrom: number, outTo: number) {
  if (local <= from) return outFrom;
  if (local >= to) return outTo;
  return mix(outFrom, outTo, (local - from) / (to - from));
}

export function ease(local: number, from: number, to: number) {
  if (local <= from) return 0;
  if (local >= to) return 1;
  const t = (local - from) / (to - from);
  return 1 - Math.pow(1 - t, 3);
}

export function mix(from: number, to: number, progress: number) {
  return from + (to - from) * progress;
}

export function textReveal(text: string, local: number, from: number, to: number) {
  return text.slice(0, Math.floor(mix(0, text.length, ease(local, from, to))));
}
