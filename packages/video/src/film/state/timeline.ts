export type ChapterShotId = 'intro-title' | 'chat-title' | 'notes-title' | 'code-title' | 'workflow-title' | 'calendar-title' | 'montage-title';
export type ContentShotId = 'chat' | 'board' | 'notes' | 'code' | 'workflow' | 'calendar' | 'montage' | 'final';
export type ShotId = ChapterShotId | ContentShotId;

export type FilmShot = {
  captionAlign?: 'left' | 'right';
  chapter?: {
    eyebrow?: string;
    subtitle?: string;
    title: string;
  };
  duration: number;
  id: ShotId;
  transition?: {
    enter?: 'cut' | 'dissolve' | 'float';
    exit?: 'fade' | 'hold';
    overlap?: number;
  };
  title?: string;
};

export type FrameCut = {at: number; remove: number};

export function cutFrames(frame: number, cuts: FrameCut[]): number {
  let source = frame;
  for (const cut of cuts) {
    if (source >= cut.at) source += cut.remove;
  }
  return source;
}

// Per-shot edit decision lists: dead-air removed from the source timeline.
// `at` is a source frame; every cut must sit outside cursor moves, eases,
// and text reveals so the splice is invisible.
export const shotCuts: Partial<Record<ContentShotId, FrameCut[]>> = {
  chat: [
    {at: 8, remove: 6},     // settle before typing starts (24)
    {at: 156, remove: 8},   // hold after reference insert (144-168)
    {at: 292, remove: 13},  // thinking shown (eased 282-290), response at 306
    {at: 362, remove: 7},   // response done (346), plan enters (370)
    {at: 415, remove: 8},   // approve clicked (414), plan resolves (420)
    {at: 483, remove: 3},   // tool rows done (482), hover move starts (486)
    {at: 527, remove: 4},   // hover ends (526), thread loads (532)
    {at: 533, remove: 5},   // thread loaded, next move starts (540)
  ],
  board: [
    {at: 6, remove: 12},    // static dashboard intro, first move starts (22)
    {at: 49, remove: 3},    // pin clicked (48), press state shows (52)
    {at: 123, remove: 6},   // title typed (122), instructions start (130)
    {at: 193, remove: 5},   // link dropdown opened (192), typing starts (200)
    {at: 230, remove: 6},   // stationary hover hold on action link (228-240)
    {at: 240, remove: 4},   // hover ends, move to save starts (244)
    {at: 265, remove: 4},   // form faded out (264), move to kanban starts (270)
  ],
  notes: [
    {at: 86, remove: 10},   // favorites shown (84), chrome reveal starts (96)
    {at: 320, remove: 8},   // completion typed (318), settle tail remains
  ],
  montage: [
    {at: 60, remove: 8},    // chat reply streamed (done 60), logs boundary (72)
    {at: 114, remove: 10},  // log expanded (110), database boundary (142)
    {at: 172, remove: 14},  // first query results settled, next query (196)
    {at: 226, remove: 14},  // second results settled, browser boundary (252)
    {at: 320, remove: 26},  // checkout page loaded (312), settle tail
  ],
  code: [
    {at: 4, remove: 9},     // floating panel intro, first move starts (18)
    {at: 116, remove: 8},   // commit menu opened (112), action press (128)
    {at: 192, remove: 6},   // move done (190), next move starts (198)
    {at: 246, remove: 8},   // cursor parked (244), terminal swap dip (254)
    {at: 286, remove: 12},  // browser settled (284), exit starts (300)
    {at: 352, remove: 6},   // publish done (350), create move starts (360)
    {at: 387, remove: 5},   // move done (386), next move starts (392)
  ],
};

export const shotSourceDurations: Record<ContentShotId, number> = {
  board: 380,
  calendar: 270,
  chat: 630,
  code: 420,
  final: 140,
  montage: 360,
  notes: 330,
  workflow: 260,
};

export function shotContentFrame(id: ShotId, frame: number) {
  const cuts = shotCuts[id as ContentShotId];
  return cuts ? cutFrames(frame, cuts) : frame;
}

export function shotOverlap(shot: FilmShot) {
  if (shot.transition?.enter !== 'dissolve') return 0;
  return shot.transition.overlap ?? 10;
}

export type FilmCaptionView = {
  alignRight: boolean;
  opacity: number;
  title: string;
  y: number;
};

export const shots: FilmShot[] = [
  {id: 'intro-title', chapter: {eyebrow: '0', title: 'AgentBuddy is...'}, duration: 66},
  {id: 'chat-title', chapter: {eyebrow: '1', title: 'More than just an AI chat'}, duration: 66},
  {id: 'chat', duration: 576, transition: {exit: 'hold'}},
  {id: 'board', duration: 340, transition: {enter: 'dissolve', overlap: 10}},
  {id: 'notes-title', chapter: {eyebrow: '2', title: 'More than just a note taker'}, duration: 66},
  {id: 'notes', duration: 312},
  {id: 'code-title', chapter: {eyebrow: '3', title: 'More than just an IDE'}, duration: 66},
  {id: 'code', duration: 366},
  {id: 'workflow-title', chapter: {eyebrow: '4', title: 'More than just a workflow engine'}, duration: 66},
  {id: 'workflow', duration: 260},
  {id: 'calendar-title', chapter: {eyebrow: '5', title: 'More than just a calendar'}, duration: 66},
  {id: 'calendar', duration: 270},
  {id: 'montage', duration: 288, transition: {enter: 'dissolve', exit: 'fade', overlap: 10}},
  {id: 'final', duration: 140},
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
