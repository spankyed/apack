import {cutFrames} from '../src/film/state/timeline';
import {montageSegmentBoundaries} from '../src/film/state/montage';
import {workflowBeats} from '../src/film/state/workflow';
import {
  simpleSceneCuts,
  simpleSceneSourceDurations,
  simpleScenes,
  simpleTotalFrames,
  threadsBoardSourceStart,
  type SimpleContentId,
} from '../src/film/simple/timeline';

// Structural audit for the simple (full-UI, hard-cut, click-driven) film:
// scene durations must match their EDLs, frame remaps must stay monotonic
// and endpoint-exact, click-response frames must survive the cuts, and the
// locked chapter copy must appear exactly as written in LAUNCH_FILM_GOAL.md.

type Failure = {check: string; detail: string};
const failures: Failure[] = [];
let checks = 0;

function check(name: string, pass: boolean, detail: string) {
  checks += 1;
  if (!pass) failures.push({check: name, detail});
}

const contentScenes = simpleScenes.filter(scene => !scene.card);

for (const scene of contentScenes) {
  const id = scene.id as SimpleContentId;
  const source = simpleSceneSourceDurations[id];
  const cuts = simpleSceneCuts[id] ?? [];
  const removed = cuts.reduce((sum, cut) => sum + cut.remove, 0);

  check(
    'scene duration matches EDL',
    scene.duration === source - removed,
    `${id}: duration ${scene.duration} !== source ${source} - removed ${removed}`,
  );

  const sorted = cuts.every((cut, index) => index === 0 || cuts[index - 1].at + cuts[index - 1].remove <= cut.at);
  check('cuts sorted and non-overlapping', sorted, `${id}: cut windows overlap or are unsorted`);

  let previous = -1;
  let monotonic = true;
  for (let frame = 0; frame < scene.duration; frame += 1) {
    const mapped = cutFrames(frame, cuts);
    if (mapped <= previous) monotonic = false;
    previous = mapped;
  }
  check('frame remap strictly increasing', monotonic, `${id}: cutFrames not strictly increasing`);
  check(
    'frame remap endpoint-exact',
    cutFrames(scene.duration - 1, cuts) === source - 1,
    `${id}: last presented frame maps to ${cutFrames(scene.duration - 1, cuts)}, expected ${source - 1}`,
  );
}

// A source frame survives the EDL iff it is not inside any removed window.
function sourceFrameSurvives(id: SimpleContentId, sourceFrame: number) {
  return !(simpleSceneCuts[id] ?? []).some(cut => sourceFrame >= cut.at && sourceFrame < cut.at + cut.remove);
}

// The montage's plugin/query switches are instant click responses; every
// switch frame (and the browser segment's absence) must survive the cuts.
const montageSource = simpleSceneSourceDurations.montage;
check(
  'montage ends before the browser segment',
  montageSource <= montageSegmentBoundaries[montageSegmentBoundaries.length - 1],
  `montage source duration ${montageSource} reaches into the browser segment`,
);
for (const boundary of montageSegmentBoundaries.filter(at => at < montageSource)) {
  check(
    'montage switch frames survive the cuts',
    sourceFrameSurvives('montage', boundary),
    `montage switch at source ${boundary} was removed by a cut`,
  );
}

// The threads scene's breadcrumb navigation: the click (648) and the board
// story start (656) must both survive, with the board phase aligned.
check(
  'threads breadcrumb click survives the cuts',
  sourceFrameSurvives('threads', 648) && sourceFrameSurvives('threads', threadsBoardSourceStart),
  'threads nav click or board start frame was removed by a cut',
);
check(
  'threads scene spans chat + nav + board stories',
  simpleSceneSourceDurations.threads === threadsBoardSourceStart + 380,
  `threads source duration ${simpleSceneSourceDurations.threads} !== ${threadsBoardSourceStart} + 380`,
);

check(
  'workflow cut splices straight into action beats',
  cutFrames(80, simpleSceneCuts.workflow ?? []) === workflowBeats.action1.from,
  `presented frame 80 maps to ${cutFrames(80, simpleSceneCuts.workflow ?? [])}, expected ${workflowBeats.action1.from}`,
);

const lockedCards = [
  'AgentBuddy is...',
  'More than just an AI chat',
  'More than just a note taker',
  'More than just an IDE',
  'More than just a workflow engine',
  'More than just a calendar',
];
const cardTitles = simpleScenes.filter(scene => scene.card).map(scene => scene.card?.title);
check(
  'chapter cards use the locked copy in order',
  JSON.stringify(cardTitles) === JSON.stringify(lockedCards),
  `cards are ${JSON.stringify(cardTitles)}`,
);
check(
  'revolution copy appears only as the final lockup',
  !cardTitles.some(title => title?.includes('revolution')) && simpleScenes[simpleScenes.length - 1].id === 'final',
  'revolution copy duplicated on a card or final scene misplaced',
);

check(
  'one content scene per chapter',
  simpleScenes.every((scene, index) =>
    index === 0 || !scene.card || simpleScenes[index + 1]?.card === undefined,
  ),
  'a chapter card is followed by another card instead of its scene',
);

check(
  'total frames equal scene sum',
  simpleTotalFrames === simpleScenes.reduce((sum, scene) => sum + scene.duration, 0),
  `simpleTotalFrames ${simpleTotalFrames}`,
);

if (failures.length > 0) {
  console.error(`Simple film audit failed: ${failures.length} of ${checks} checks.`);
  for (const failure of failures) {
    console.error(`- [${failure.check}] ${failure.detail}`);
  }
  process.exit(1);
}

console.log(`Simple film audit passed: ${checks} structural checks across ${contentScenes.length} scenes.`);
