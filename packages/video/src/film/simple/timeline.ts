import {cutFrames, type FrameCut} from '../state/timeline';

export type SimpleCardId = 'intro-card' | 'chat-card' | 'notes-card' | 'code-card' | 'workflow-card' | 'calendar-card';
export type SimpleContentId = 'threads' | 'notes' | 'code' | 'workflow' | 'calendar' | 'montage' | 'final';
export type SimpleSceneId = SimpleCardId | SimpleContentId;

export type SimpleScene = {
  card?: {
    eyebrow?: string;
    subtitle?: string;
    title: string;
  };
  duration: number;
  id: SimpleSceneId;
};

// The threads scene plays the chat story (source 0-629), then a cursor move
// to the Threads breadcrumb (click at 648), then the board story starting at
// this source offset. Board-story cuts below are board cuts shifted by it.
export const threadsBoardSourceStart = 656;

// Every chapter is one long scene in a steady full-app frame. View changes
// happen instantly at real button clicks (no fades, no dissolves), so these
// EDLs only have to dodge cursor moves and text reveals in source frames.
// Each cut removes source window [at, at + remove).
export const simpleSceneCuts: Partial<Record<SimpleContentId, FrameCut[]>> = {
  threads: [
    // Chat story (source 0-655).
    {at: 14, remove: 6},    // quote settled (12), typing starts (24)
    {at: 42, remove: 66},   // items menu shown (35), trim most of the static hold so the arrow-down (112) lands ~0.2s after it opens
    {at: 156, remove: 8},   // hold after reference insert (144-168)
    {at: 292, remove: 13},  // thinking shown (eased 282-290), response at 306
    {at: 362, remove: 7},   // response done (346), plan enters (370)
    {at: 415, remove: 8},   // approve clicked (414), plan resolves (420)
    {at: 483, remove: 3},   // tool rows done (482), hover move starts (486)
    {at: 527, remove: 4},   // hover ends (526), thread loads (532)
    {at: 533, remove: 5},   // thread loaded, next move starts (540)
    // Board story (board source frame + 656).
    {at: 662, remove: 12},  // static dashboard intro, first move starts (678)
    {at: 705, remove: 3},   // pin clicked (704), press state shows (708)
    {at: 779, remove: 6},   // title typed (778), instructions start (786)
    {at: 849, remove: 5},   // link dropdown opened (848), typing starts (856)
    {at: 886, remove: 6},   // stationary hover hold on action link (884-896)
    {at: 896, remove: 4},   // hover ends, move to save starts (900)
    {at: 921, remove: 4},   // form closed (920), move to kanban starts (926)
  ],
  notes: [
    {at: 36, remove: 82},   // home shown at once (0); hold ~1.2s, then trim the static hold to the New Note move (118)
    {at: 320, remove: 8},   // completion typed (318), settle tail remains
  ],
  code: [
    {at: 4, remove: 9},     // static intro, first move starts (18)
    {at: 116, remove: 8},   // commit menu opened (112), action press (128)
    {at: 192, remove: 6},   // move done (190), next move starts (198)
    {at: 246, remove: 70},  // tests shown (220+); skip browser pop-over entirely
    {at: 352, remove: 6},   // publish done (350), create move starts (360)
    {at: 387, remove: 5},   // move done (386), next move starts (392)
  ],
  workflow: [
    {at: 80, remove: 88},   // chrome beats pinned: jump from drawn edge (76) to action1 (168)
  ],
  montage: [
    {at: 66, remove: 6},    // reply streamed (60), trim hold before logs boundary (72)
  ],
};

export const simpleSceneSourceDurations: Record<SimpleContentId, number> = {
  calendar: 270,
  code: 420,
  final: 140,
  montage: 252,  // browser segment (252+) is not part of the simple film
  notes: 330,
  threads: threadsBoardSourceStart + 380,
  workflow: 260,
};

export function simpleSceneFrame(id: SimpleSceneId, frame: number) {
  const cuts = simpleSceneCuts[id as SimpleContentId];
  return cuts ? cutFrames(frame, cuts) : frame;
}

export const simpleScenes: SimpleScene[] = [
  {id: 'intro-card', card: {eyebrow: '0', title: 'AgentBuddy is...'}, duration: 66},
  {id: 'chat-card', card: {eyebrow: '1', title: 'More than just an AI chat'}, duration: 66},
  {id: 'threads', duration: 876},
  {id: 'notes-card', card: {eyebrow: '2', title: 'More than just a note taker'}, duration: 66},
  {id: 'notes', duration: 240},
  {id: 'code-card', card: {eyebrow: '3', title: 'More than just an IDE'}, duration: 66},
  {id: 'code', duration: 316},
  {id: 'workflow-card', card: {eyebrow: '4', title: 'More than just a workflow engine'}, duration: 66},
  {id: 'workflow', duration: 172},
  {id: 'calendar-card', card: {eyebrow: '5', title: 'More than just a calendar'}, duration: 66},
  {id: 'calendar', duration: 270},
  {id: 'montage', duration: 246},
  {id: 'final', duration: 140},
];

export const simpleTotalFrames = simpleScenes.reduce((sum, scene) => sum + scene.duration, 0);
