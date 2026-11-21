import {readFileSync} from 'node:fs';
import {boardViewForFrame} from '../src/film/state/board';
import {chatViewForFrame, toolActivityViewForFrame} from '../src/film/state/chat';
import {codeReviewViewForFrame, codeShotState} from '../src/film/state/code';
import {finalViewForFrame} from '../src/film/state/final';
import {notesViewForFrame} from '../src/film/state/notes';
import {workflowStateForFrame} from '../src/film/state/workflow';

type Check = {
  area: ProductArea | 'final';
  message: string;
  pass: boolean;
};

type ProductArea = 'board' | 'chat' | 'code' | 'notes' | 'workflow';

function changed<T>(before: T, after: T) {
  return JSON.stringify(before) !== JSON.stringify(after);
}

const flowCanvasCss = readFileSync(new URL('../src/agentbuddy-ui/flows/FlowCanvas.module.css', import.meta.url), 'utf8');
const flowEdgeSource = readFileSync(new URL('../src/agentbuddy-ui/flows/FlowEdge.tsx', import.meta.url), 'utf8');
const workflowSource = readFileSync(new URL('../src/film/state/workflow.ts', import.meta.url), 'utf8');

const checks: Check[] = [
  {
    area: 'notes',
    message: 'notes shot reveals first edited line',
    pass: notesViewForFrame(20).animatedLines[0].text !== notesViewForFrame(120).animatedLines[0].text,
  },
  {
    area: 'notes',
    message: 'notes shot reveals second edited line',
    pass: notesViewForFrame(110).animatedLines[1].text !== notesViewForFrame(210).animatedLines[1].text,
  },
  {
    area: 'notes',
    message: 'notes shot reveals third edited line',
    pass: notesViewForFrame(150).animatedLines[2].text !== notesViewForFrame(250).animatedLines[2].text,
  },
  {
    area: 'chat',
    message: 'chat shot types user prompt',
    pass: chatViewForFrame(0).prompt !== chatViewForFrame(92).prompt,
  },
  {
    area: 'chat',
    message: 'chat shot reveals assistant response',
    pass: chatViewForFrame(150).response !== chatViewForFrame(260).response,
  },
  {
    area: 'chat',
    message: 'chat tool activity reveals rows sequentially',
    pass: toolActivityViewForFrame(70).rowOpacities[0] !== toolActivityViewForFrame(150).rowOpacities[0]
      && toolActivityViewForFrame(70).rowOpacities[3] !== toolActivityViewForFrame(180).rowOpacities[3],
  },
  {
    area: 'chat',
    message: 'chat tool activity transitions from streaming to done',
    pass: toolActivityViewForFrame(220).state.state === 'streaming'
      && toolActivityViewForFrame(240).state.state === 'done',
  },
  {
    area: 'board',
    message: 'board shot moves card horizontally',
    pass: boardViewForFrame(0).movingCardStyle.left !== boardViewForFrame(170).movingCardStyle.left,
  },
  {
    area: 'board',
    message: 'board shot moves card vertically',
    pass: boardViewForFrame(0).movingCardStyle.top !== boardViewForFrame(170).movingCardStyle.top,
  },
  {
    area: 'board',
    message: 'board shot rotates moving card',
    pass: boardViewForFrame(0).movingCardStyle.transform !== boardViewForFrame(170).movingCardStyle.transform,
  },
  {
    area: 'code',
    message: 'code shot reveals diff changes line by line',
    pass: changed(codeReviewViewForFrame(20).diffLineOpacities, codeReviewViewForFrame(120).diffLineOpacities),
  },
  {
    area: 'code',
    message: 'code shot generates commit message',
    pass: codeReviewViewForFrame(80).commitMessage === ''
      && codeReviewViewForFrame(130).commitMessage === codeShotState.generatedCommitMessage,
  },
  {
    area: 'code',
    message: 'code shot switches from commit panel to PR panel',
    pass: codeReviewViewForFrame(0).activePanel === 'commit'
      && codeReviewViewForFrame(170).activePanel === 'pr',
  },
  {
    area: 'code',
    message: 'code shot publishes branch before PR creation',
    pass: codeReviewViewForFrame(150).prPublishProgress === 0
      && codeReviewViewForFrame(190).prPublishProgress === 1,
  },
  {
    area: 'code',
    message: 'code shot progresses through PR files, create, and details modes',
    pass: codeReviewViewForFrame(160).prMode === 'files'
      && codeReviewViewForFrame(200).prMode === 'create'
      && codeReviewViewForFrame(230).prMode === 'details'
      && Boolean(codeReviewViewForFrame(230).pullRequest.createdPr),
  },
  {
    area: 'workflow',
    message: 'workflow shot moves blueprint viewport',
    pass: changed(workflowStateForFrame(0).viewport, workflowStateForFrame(260).viewport),
  },
  {
    area: 'workflow',
    message: 'workflow shot stays blueprint-only without runtime status or animated node selection',
    pass: workflowStateForFrame(130).selectedNodeId == null
      && workflowStateForFrame(130).editingNodeId == null
      && !JSON.stringify(workflowStateForFrame(260)).includes('"status"'),
  },
  {
    area: 'workflow',
    message: 'flow execution edges use renderer-style CSS dash animation',
    pass: flowCanvasCss.includes('stroke-dasharray: 5 5')
      && flowCanvasCss.includes('@keyframes FlowCanvas_dashFlow')
      && flowCanvasCss.includes('stroke-dashoffset: -10')
      && !flowEdgeSource.includes('strokeDashoffset')
      && !workflowSource.includes('edgeDashOffset'),
  },
  {
    area: 'final',
    message: 'final shot animates title',
    pass: finalViewForFrame(0).titleStyle.opacity !== finalViewForFrame(80).titleStyle.opacity,
  },
  {
    area: 'final',
    message: 'final shot animates tagline',
    pass: finalViewForFrame(0).taglineStyle.opacity !== finalViewForFrame(100).taglineStyle.opacity,
  },
];

const failed = checks.filter(check => !check.pass);
const minimumMoments = 10;
const minimumProductMoments = 10;
const requiredProductAreas = new Set<ProductArea>(['board', 'chat', 'code', 'notes', 'workflow']);
const productChecks = checks.filter(check => check.area !== 'final');
const coveredProductAreas = new Set(productChecks.map(check => check.area));
const missingProductAreas = [...requiredProductAreas].filter(area => !coveredProductAreas.has(area));

if (failed.length > 0) {
  throw new Error(`Film action audit failed:\n${failed.map(check => `- ${check.message}`).join('\n')}`);
}

if (checks.length < minimumMoments) {
  throw new Error(`Film action audit must prove at least ${minimumMoments} frame-driven moments; only ${checks.length} checks exist.`);
}

if (productChecks.length < minimumProductMoments) {
  throw new Error(`Film action audit must prove at least ${minimumProductMoments} product-surface moments before the final lockup; only ${productChecks.length} checks exist.`);
}

if (missingProductAreas.length > 0) {
  throw new Error(`Film action audit must cover every product surface area; missing ${missingProductAreas.join(', ')}.`);
}

console.log(`Film action audit passed: ${checks.length} frame-driven shot checks across ${coveredProductAreas.size} product areas.`);
