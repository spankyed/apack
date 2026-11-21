import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function main() {
  const requireActualAppScreenshots = process.env.REQUIRE_ACTUAL_APP_SCREENSHOTS === '1';
  const fidelityPath = path.join(packageDir, 'src/agentbuddy-ui/FIDELITY.md');
  const visualReviewPath = path.join(packageDir, 'src/agentbuddy-ui/VISUAL_REVIEW.md');
  const actualReferencesPath = path.join(packageDir, 'src/agentbuddy-ui/ACTUAL_APP_REFERENCES.md');
  const reviewSnapshotsPath = path.join(packageDir, 'src/agentbuddy-ui/REVIEW_SNAPSHOTS.md');
  const componentDemosPath = path.join(packageDir, 'src/agentbuddy-ui/COMPONENT_DEMOS.md');
  const outputsPath = path.join(packageDir, 'src/film/OUTPUTS.md');
  const rootPackagePath = path.join(packageDir, '..', '..', 'package.json');
  const rootPath = path.join(packageDir, 'src/Root.tsx');
  const srcDir = path.join(packageDir, 'src');
  const uiDir = path.join(packageDir, 'src/agentbuddy-ui');
  const flowsDir = path.join(uiDir, 'flows');
  const filmShotsDir = path.join(packageDir, 'src/film/shots');
  const filmStateDir = path.join(packageDir, 'src/film/state');
  const demoDir = path.join(packageDir, 'src/compositions/demos');

  const [fidelity, visualReview, actualReferences, reviewSnapshots, componentDemos, outputs, rootPackage, root] = await Promise.all([
    fs.readFile(fidelityPath, 'utf8'),
    fs.readFile(visualReviewPath, 'utf8'),
    fs.readFile(actualReferencesPath, 'utf8'),
    fs.readFile(reviewSnapshotsPath, 'utf8'),
    fs.readFile(componentDemosPath, 'utf8'),
    fs.readFile(outputsPath, 'utf8'),
    fs.readFile(rootPackagePath, 'utf8'),
    fs.readFile(rootPath, 'utf8'),
  ]);

  const registered = new Set([...root.matchAll(/<Composition\s+id="([^"]+)"/g)].map(match => match[1]));
  const registeredDemos = new Set([...registered].filter(name => name.endsWith('Demo')));
  const rootScripts = JSON.parse(rootPackage).scripts ?? {};
  const fidelitySurfaces = new Set();
  const referenced = new Set();
  const documentedLocalPaths = new Set();
  const documentedRendererPaths = new Set();
  const uncheckedRendererRefs = [];

  for (const line of fidelity.split('\n')) {
    if (!line.startsWith('|') || line.includes('---')) continue;
    const cells = line.split('|').map(cell => cell.trim());
    const replicaCell = cells[2] ?? '';
    const rendererCell = cells[3] ?? '';
    const demoCell = cells[4] ?? '';
    const surfaceName = cells[1] ?? '';
    if (surfaceName && surfaceName !== 'Surface') fidelitySurfaces.add(surfaceName);
    for (const match of replicaCell.matchAll(/`([^`]+)`/g)) {
      const localPath = match[1];
      if (localPath.includes('/')) documentedLocalPaths.add(localPath);
    }
    for (const match of rendererCell.matchAll(/`([^`]+)`/g)) {
      const rendererPath = match[1];
      if (rendererPath === 'NO_RENDERER_EQUIVALENT') continue;
      if (rendererPath.startsWith('packages/renderer/')) {
        documentedRendererPaths.add(rendererPath);
      } else {
        uncheckedRendererRefs.push(rendererPath);
      }
    }
    for (const match of demoCell.matchAll(/`([^`]+)`/g)) {
      const name = match[1];
      if (name.endsWith('Demo') || name.endsWith('Film')) referenced.add(name);
    }
  }

  const visualReviewRows = parseMarkdownRows(visualReview);
  const reviewedSurfaces = new Set();
  const missingReviewRenders = [];
  const uncheckedReviewRefs = [];

  for (const cells of visualReviewRows) {
    const surfaceName = cells[1] ?? '';
    const referenceCell = cells[2] ?? '';
    const renderCell = cells[3] ?? '';
    if (!surfaceName || surfaceName === 'Surface') continue;
    reviewedSurfaces.add(surfaceName);

    for (const match of referenceCell.matchAll(/`([^`]+)`/g)) {
      const rendererPath = match[1];
      if (rendererPath === 'NO_RENDERER_EQUIVALENT') continue;
      if (!rendererPath.startsWith('packages/renderer/')) uncheckedReviewRefs.push(rendererPath);
    }

    const renderPaths = [...renderCell.matchAll(/`([^`]+)`/g)].map(match => match[1]);
    if (renderPaths.length === 0) missingReviewRenders.push(`${surfaceName}: no current render artifact`);
    for (const renderPath of renderPaths) {
      const fullPath = path.join(packageDir, '..', '..', renderPath);
      if (!(await exists(fullPath))) missingReviewRenders.push(`${surfaceName}: ${renderPath}`);
    }
  }

  const missingReviewSurfaces = [...fidelitySurfaces].filter(surface => !reviewedSurfaces.has(surface));

  const actualReferenceRows = parseMarkdownRows(actualReferences);
  const actualReferenceSurfaces = new Set();
  const actualReferenceErrors = [];
  const unresolvedActualScreenshots = [];
  const conversationOnlyActualReferences = [];
  const missingActualCaptureTargets = [];
  for (const cells of actualReferenceRows) {
    const surfaceName = cells[1] ?? '';
    const evidenceCell = cells[2] ?? '';
    const targetCell = cells[3] ?? '';
    if (!surfaceName || surfaceName === 'Surface') continue;
    actualReferenceSurfaces.add(surfaceName);
    const refs = [...evidenceCell.matchAll(/`([^`]+)`/g)].map(match => match[1]);
    const targetRefs = [...targetCell.matchAll(/`([^`]+)`/g)].map(match => match[1]);
    if (refs.length === 0) actualReferenceErrors.push(`${surfaceName}: no actual-app evidence marker`);
    const needsDurableCapture = refs.some(ref => ref === 'NEEDS_SCREENSHOT' || ref.startsWith('conversation:'));
    if (refs.includes('NO_RENDERER_EQUIVALENT')) {
      if (targetRefs.length > 0 && !targetRefs.includes('NO_RENDERER_EQUIVALENT')) {
        actualReferenceErrors.push(`${surfaceName}: film-only surface must use NO_RENDERER_EQUIVALENT as target`);
      }
    } else if (needsDurableCapture && targetRefs.length === 0) {
      actualReferenceErrors.push(`${surfaceName}: unresolved actual-app evidence must list target local capture filename`);
    }
    for (const targetRef of targetRefs) {
      if (targetRef === 'NO_RENDERER_EQUIVALENT') continue;
      if (!targetRef.startsWith('packages/video/reference/actual-app/') || !/\.(png|jpe?g|webp)$/i.test(targetRef)) {
        actualReferenceErrors.push(`${surfaceName}: invalid target local capture ${targetRef}`);
        continue;
      }
      const targetFullPath = path.join(packageDir, '..', '..', targetRef);
      if (needsDurableCapture && !(await exists(targetFullPath))) missingActualCaptureTargets.push(`${surfaceName}: ${targetRef}`);
    }
    for (const ref of refs) {
      if (ref === 'NEEDS_SCREENSHOT') {
        unresolvedActualScreenshots.push(surfaceName);
        continue;
      }
      if (ref === 'NO_RENDERER_EQUIVALENT') continue;
      if (ref.startsWith('conversation:')) {
        conversationOnlyActualReferences.push(`${surfaceName}: ${ref}`);
        continue;
      }
      if (!ref.startsWith('packages/video/reference/actual-app/') || !/\.(png|jpe?g|webp)$/i.test(ref)) {
        actualReferenceErrors.push(`${surfaceName}: invalid evidence reference ${ref}`);
        continue;
      }
      const fullPath = path.join(packageDir, '..', '..', ref);
      if (!(await exists(fullPath))) actualReferenceErrors.push(`${surfaceName}: missing actual-app reference ${ref}`);
    }
  }

  const missingActualReferenceSurfaces = [...reviewedSurfaces].filter(surface => !actualReferenceSurfaces.has(surface));

  const knownSnapshotSources = new Set();
  for (const cells of parseMarkdownRows(componentDemos)) {
    const outputPath = stripBackticks(cells[2] ?? '');
    if (outputPath && outputPath !== 'Output') knownSnapshotSources.add(outputPath);
  }
  for (const cells of parseMarkdownRows(outputs)) {
    const outputPath = stripBackticks(cells[4] ?? '');
    if (outputPath && outputPath !== 'Output') knownSnapshotSources.add(outputPath);
  }

  const snapshotRows = parseMarkdownRows(reviewSnapshots);
  const snapshotSurfaces = new Set();
  const snapshotErrors = [];
  for (const cells of snapshotRows) {
    const surfaceName = cells[1] ?? '';
    const sourceRender = stripBackticks(cells[2] ?? '');
    const timestamp = stripBackticks(cells[3] ?? '');
    const snapshot = stripBackticks(cells[4] ?? '');
    if (!surfaceName || surfaceName === 'Surface') continue;
    snapshotSurfaces.add(surfaceName);
    if (!sourceRender.startsWith('packages/video/out/') || !sourceRender.endsWith('.mp4')) {
      snapshotErrors.push(`${surfaceName}: source render must be an mp4 under packages/video/out`);
    }
    if (!knownSnapshotSources.has(sourceRender)) {
      snapshotErrors.push(`${surfaceName}: source render is not listed in COMPONENT_DEMOS.md or OUTPUTS.md: ${sourceRender}`);
    }
    if (!/^\d+(\.\d+)?$/.test(timestamp)) {
      snapshotErrors.push(`${surfaceName}: timestamp must be seconds as a number`);
    }
    if (!snapshot.startsWith('packages/video/out/review-snapshots/') || !snapshot.endsWith('.png')) {
      snapshotErrors.push(`${surfaceName}: snapshot must be a png under packages/video/out/review-snapshots`);
    }
    for (const artifactPath of [sourceRender, snapshot]) {
      const fullPath = path.join(packageDir, '..', '..', artifactPath);
      if (!(await exists(fullPath))) snapshotErrors.push(`${surfaceName}: missing ${artifactPath}`);
    }
    const sourceFullPath = path.join(packageDir, '..', '..', sourceRender);
    const snapshotFullPath = path.join(packageDir, '..', '..', snapshot);
    if ((await exists(sourceFullPath)) && (await exists(snapshotFullPath))) {
      const [sourceStat, snapshotStat] = await Promise.all([fs.stat(sourceFullPath), fs.stat(snapshotFullPath)]);
      if (snapshotStat.mtimeMs < sourceStat.mtimeMs) {
        snapshotErrors.push(`${surfaceName}: snapshot ${snapshot} is older than source render ${sourceRender}`);
      }
    }
  }

  const missingSnapshotSurfaces = [...fidelitySurfaces].filter(surface => !snapshotSurfaces.has(surface));

  const outputRows = parseMarkdownRows(outputs);
  const outputErrors = [];
  const outputFreshnessErrors = [];
  const latestRenderInput = await latestMtime(await listFiles(srcDir, file => /\.(css|ts|tsx)$/.test(file)));
  for (const cells of outputRows) {
    const variant = cells[1] ?? '';
    const composition = stripBackticks(cells[2] ?? '');
    const command = stripBackticks(cells[3] ?? '');
    const outputPath = stripBackticks(cells[4] ?? '');
    if (!variant || variant === 'Variant') continue;
    if (!registered.has(composition)) outputErrors.push(`${variant}: composition ${composition} is not registered`);
    if (!command.startsWith('npm run video:render')) outputErrors.push(`${variant}: command must use npm run video:render*`);
    const scriptName = command.match(/^npm run ([^ ]+)$/)?.[1];
    if (!scriptName || typeof rootScripts[scriptName] !== 'string') {
      outputErrors.push(`${variant}: command ${command} is not a root package script`);
    }
    if (!outputPath.startsWith('packages/video/out/') || !outputPath.endsWith('.mp4')) outputErrors.push(`${variant}: output must be an mp4 under packages/video/out`);
    const fullPath = path.join(packageDir, '..', '..', outputPath);
    if (!(await exists(fullPath))) outputErrors.push(`${variant}: missing output ${outputPath}`);
    else if ((await fs.stat(fullPath)).mtimeMs < latestRenderInput) {
      outputFreshnessErrors.push(`${variant}: ${outputPath} is older than current src render inputs; rerun ${command}`);
    }
  }

  const componentDemoRows = parseMarkdownRows(componentDemos);
  const componentDemoErrors = [];
  const componentDemoFreshnessErrors = [];
  const renderedDemoCompositions = new Set();
  for (const cells of componentDemoRows) {
    const composition = stripBackticks(cells[1] ?? '');
    const outputPath = stripBackticks(cells[2] ?? '');
    if (!composition || composition === 'Composition') continue;
    renderedDemoCompositions.add(composition);
    if (!composition.endsWith('Demo')) componentDemoErrors.push(`${composition}: composition must be a demo composition`);
    if (!registered.has(composition)) componentDemoErrors.push(`${composition}: composition is not registered`);
    if (!outputPath.startsWith('packages/video/out/component-demos/') || !outputPath.endsWith('.mp4')) {
      componentDemoErrors.push(`${composition}: output must be an mp4 under packages/video/out/component-demos`);
    }
    const fullPath = path.join(packageDir, '..', '..', outputPath);
    if (!(await exists(fullPath))) componentDemoErrors.push(`${composition}: missing output ${outputPath}`);
    else if ((await fs.stat(fullPath)).mtimeMs < latestRenderInput) {
      componentDemoFreshnessErrors.push(`${composition}: ${outputPath}`);
    }
  }

  const missingRenderedReferencedDemos = [...referenced].filter(name => name.endsWith('Demo') && !renderedDemoCompositions.has(name));
  const missingRegisteredDemoRenders = [...registeredDemos].filter(name => !renderedDemoCompositions.has(name));
  const unknownRenderedDemos = [...renderedDemoCompositions].filter(name => !registeredDemos.has(name));

  const missing = [...referenced].filter(name => !registered.has(name));
  if (missing.length > 0) {
    throw new Error(`FIDELITY.md references unregistered compositions: ${missing.join(', ')}`);
  }
  if (missingReviewSurfaces.length > 0) {
    throw new Error(`VISUAL_REVIEW.md is missing surfaces from FIDELITY.md: ${missingReviewSurfaces.join(', ')}`);
  }
  if (missingActualReferenceSurfaces.length > 0) {
    throw new Error(`ACTUAL_APP_REFERENCES.md is missing surfaces from VISUAL_REVIEW.md: ${missingActualReferenceSurfaces.join(', ')}`);
  }
  if (actualReferenceErrors.length > 0) {
    throw new Error(`ACTUAL_APP_REFERENCES.md has invalid entries: ${actualReferenceErrors.join(', ')}`);
  }
  if (missingSnapshotSurfaces.length > 0) {
    throw new Error(`REVIEW_SNAPSHOTS.md is missing surfaces from FIDELITY.md: ${missingSnapshotSurfaces.join(', ')}`);
  }
  if (snapshotErrors.length > 0) {
    throw new Error(`REVIEW_SNAPSHOTS.md has invalid or missing snapshot entries: ${snapshotErrors.join(', ')}`);
  }
  if (outputErrors.length > 0) {
    throw new Error(`OUTPUTS.md has invalid publishable output entries: ${outputErrors.join(', ')}`);
  }
  if (outputFreshnessErrors.length > 0) {
    throw new Error(`Publishable film outputs are stale: ${outputFreshnessErrors.join(', ')}`);
  }
  if (componentDemoErrors.length > 0) {
    throw new Error(`COMPONENT_DEMOS.md has invalid or missing demo output entries: ${componentDemoErrors.join(', ')}`);
  }
  if (componentDemoFreshnessErrors.length > 0) {
    throw new Error(`Component demo renders are stale; rerun npm run render:demos --workspace @app/video for: ${componentDemoFreshnessErrors.join(', ')}`);
  }
  if (missingRenderedReferencedDemos.length > 0) {
    throw new Error(`COMPONENT_DEMOS.md is missing demos referenced by FIDELITY.md: ${missingRenderedReferencedDemos.join(', ')}`);
  }
  if (missingRegisteredDemoRenders.length > 0) {
    throw new Error(`COMPONENT_DEMOS.md is missing registered demo compositions: ${missingRegisteredDemoRenders.join(', ')}`);
  }
  if (unknownRenderedDemos.length > 0) {
    throw new Error(`COMPONENT_DEMOS.md lists demos that are not registered compositions: ${unknownRenderedDemos.join(', ')}`);
  }

  const missingLocalPaths = [];
  for (const localPath of documentedLocalPaths) {
    const fullPath = localPath.startsWith('film/')
      ? path.join(srcDir, localPath)
      : path.join(uiDir, localPath);
    if (!(await exists(fullPath))) missingLocalPaths.push(localPath.startsWith('film/') ? localPath : `agentbuddy-ui/${localPath}`);
  }

  const missingRendererPaths = [];
  for (const rendererPath of documentedRendererPaths) {
    const fullPath = path.join(packageDir, '..', '..', rendererPath);
    if (!(await exists(fullPath))) missingRendererPaths.push(rendererPath);
  }

  const uiFiles = await listFiles(uiDir);
  const undocumentedComponents = [];
  const remotionLeaks = [];
  const filmLeaks = [];
  const stateRemotionLeaks = [];
  const shotStateImportLeaks = [];
  const shotFixtureLeaks = [];
  const demoFixtureLeaks = [];
  const demoRawStyleLeaks = [];
  const flowRuntimeLeaks = [];
  const forbiddenIndicators = [];
  const fixtureLeaks = [];
  const forbiddenIndicatorPatterns = [
    /\bisTyping\b/,
    /TypingIndicator/,
    /typingPulse/,
    /streamingDots/,
    /streamingPulse/,
    /Assistant is typing/,
  ];
  const forbiddenFixturePatterns = [
    /AgentBuddy/i,
    /Clientlabs/i,
    /spankyed/i,
    /as\/react-launch-film/i,
    /packages\/video/i,
    /launch film/i,
    /Preview build passed/i,
    /Release checks passed/i,
  ];

  await Promise.all(uiFiles.map(async file => {
    if (!/\.(ts|tsx)$/.test(file)) return;
    const source = await fs.readFile(file, 'utf8');
    const relative = path.relative(packageDir, file);
    const uiRelative = path.relative(uiDir, file);
    if (/\.tsx$/.test(file) && !uiRelative.startsWith('primitives/') && !documentedLocalPaths.has(uiRelative)) {
      undocumentedComponents.push(uiRelative);
    }
    if (/from ['"]remotion['"]|useCurrentFrame|useVideoConfig|spring\(/.test(source)) remotionLeaks.push(relative);
    if (/from ['"].*\.\.\/\.\.\/film|from ['"].*\.\.\/film|from ['"].*\/film\//.test(source)) filmLeaks.push(relative);
    if (forbiddenIndicatorPatterns.some(pattern => pattern.test(source))) forbiddenIndicators.push(relative);
    if (forbiddenFixturePatterns.some(pattern => pattern.test(source))) fixtureLeaks.push(relative);
  }));

  const stateFiles = await listFiles(filmStateDir);
  await Promise.all(stateFiles.map(async file => {
    if (!/\.(ts|tsx)$/.test(file)) return;
    const source = await fs.readFile(file, 'utf8');
    const relative = path.relative(packageDir, file);
    if (/from ['"]remotion['"]|useCurrentFrame|useVideoConfig|spring\(|interpolate\(/.test(source)) stateRemotionLeaks.push(relative);
  }));

  const shotFiles = await listFiles(filmShotsDir);
  await Promise.all(shotFiles.map(async file => {
    const basename = path.basename(file);
    const relative = path.relative(packageDir, file);
    if (/\.module\.css$/.test(file)) return;
    if (!/\.(ts|tsx)$/.test(file)) return;
    const source = await fs.readFile(file, 'utf8');
    for (const match of source.matchAll(/import\s+(?!type)([\s\S]*?)\s+from\s+['"](\.\.\/state\/[^'"]+)['"]/g)) {
      if (match[2] === '../state/timeline') continue;
      if (!/(?:Shot)?ViewForFrame/.test(match[1])) shotStateImportLeaks.push(relative);
    }
    const literals = extractStringLiterals(stripModuleSpecifiers(source));
    if (literals.some(value => forbiddenFixturePatterns.some(pattern => pattern.test(value)))) shotFixtureLeaks.push(relative);
  }));

  const demoFiles = await listFiles(demoDir);
  await Promise.all(demoFiles.map(async file => {
    if (!/\.(ts|tsx)$/.test(file)) return;
    const source = await fs.readFile(file, 'utf8');
    const relative = path.relative(packageDir, file);
    const literals = extractStringLiterals(stripModuleSpecifiers(source));
    if (literals.some(value => forbiddenFixturePatterns.some(pattern => pattern.test(value)))) demoFixtureLeaks.push(relative);
    if (/<[a-z][^>]*\sstyle=/.test(source)) demoRawStyleLeaks.push(relative);
  }));

  const flowFiles = [
    ...(await listFiles(flowsDir)),
    path.join(filmStateDir, 'workflow.ts'),
  ];
  await Promise.all(flowFiles.map(async file => {
    if (!/\.(ts|tsx|css)$/.test(file)) return;
    const source = await fs.readFile(file, 'utf8');
    const relative = path.relative(packageDir, file);
    if (/\bstatus\b|edgeActive|edgeCompleted|FlowNode_status|workflowExecution/.test(source)) flowRuntimeLeaks.push(relative);
  }));

  if (remotionLeaks.length > 0) {
    throw new Error(`agentbuddy-ui must not import Remotion APIs: ${remotionLeaks.join(', ')}`);
  }
  if (undocumentedComponents.length > 0) {
    throw new Error(`agentbuddy-ui components must be documented in FIDELITY.md: ${undocumentedComponents.join(', ')}`);
  }
  if (missingLocalPaths.length > 0) {
    throw new Error(`FIDELITY.md references missing local replica files: ${missingLocalPaths.join(', ')}`);
  }
  if (missingRendererPaths.length > 0) {
    throw new Error(`FIDELITY.md references missing renderer files: ${missingRendererPaths.join(', ')}`);
  }
  if (uncheckedRendererRefs.length > 0) {
    throw new Error(`FIDELITY.md renderer references must be concrete packages/renderer paths or NO_RENDERER_EQUIVALENT: ${uncheckedRendererRefs.join(', ')}`);
  }
  if (uncheckedReviewRefs.length > 0) {
    throw new Error(`VISUAL_REVIEW.md renderer references must be concrete packages/renderer paths or NO_RENDERER_EQUIVALENT: ${uncheckedReviewRefs.join(', ')}`);
  }
  if (missingReviewRenders.length > 0) {
    throw new Error(`VISUAL_REVIEW.md references missing current render artifacts: ${missingReviewRenders.join(', ')}`);
  }
  if (filmLeaks.length > 0) {
    throw new Error(`agentbuddy-ui must not import film-layer modules: ${filmLeaks.join(', ')}`);
  }
  if (forbiddenIndicators.length > 0) {
    throw new Error(`Rejected typing/three-dot indicators found in agentbuddy-ui: ${forbiddenIndicators.join(', ')}`);
  }
  if (fixtureLeaks.length > 0) {
    throw new Error(`Film fixture/project strings must live in film/state, not agentbuddy-ui: ${fixtureLeaks.join(', ')}`);
  }
  if (stateRemotionLeaks.length > 0) {
    throw new Error(`film/state must stay data/timeline-only and not import Remotion APIs: ${stateRemotionLeaks.join(', ')}`);
  }
  if (shotFixtureLeaks.length > 0) {
    throw new Error(`Shot-specific fixture strings must live in film/state, not film/shots: ${shotFixtureLeaks.join(', ')}`);
  }
  if (shotStateImportLeaks.length > 0) {
    throw new Error(`Film shots must consume assembled *ShotViewForFrame helpers instead of raw state/view imports: ${shotStateImportLeaks.join(', ')}`);
  }
  if (demoFixtureLeaks.length > 0) {
    throw new Error(`Component demo fixture strings must live in film/state, not compositions/demos: ${demoFixtureLeaks.join(', ')}`);
  }
  if (demoRawStyleLeaks.length > 0) {
    throw new Error(`Component demos must use shared DemoLayout helpers instead of raw styled DOM wrappers: ${demoRawStyleLeaks.join(', ')}`);
  }
  if (flowRuntimeLeaks.length > 0) {
    throw new Error(`Flows film UI must remain blueprint-only; runtime status indicators belong outside flows: ${flowRuntimeLeaks.join(', ')}`);
  }
  if (requireActualAppScreenshots) {
    const strictActualAppErrors = [
      ...unresolvedActualScreenshots.map(surface => `${surface}: NEEDS_SCREENSHOT`),
      ...conversationOnlyActualReferences.map(ref => `${ref} is conversation-only`),
      ...missingActualCaptureTargets.map(target => `${target} is missing`),
    ];
    if (strictActualAppErrors.length > 0) {
      throw new Error(`Strict actual-app screenshot evidence is incomplete: ${strictActualAppErrors.join(', ')}`);
    }
  }

  console.log(`Fidelity audit passed: ${referenced.size} referenced demos registered; no agentbuddy-ui film/Remotion leaks.`);
  if (unresolvedActualScreenshots.length > 0) {
    console.log(`Actual-app screenshot debt: ${unresolvedActualScreenshots.join(', ')}`);
  }
  if (conversationOnlyActualReferences.length > 0) {
    console.log(`Conversation-only actual-app references need durable local captures: ${conversationOnlyActualReferences.join(', ')}`);
  }
  if (missingActualCaptureTargets.length > 0) {
    console.log(`Missing target actual-app capture files: ${missingActualCaptureTargets.join(', ')}`);
  }
}

async function exists(fullPath) {
  try {
    await fs.access(fullPath);
    return true;
  } catch {
    return false;
  }
}

async function listFiles(dir, predicate = () => true) {
  const entries = await fs.readdir(dir, {withFileTypes: true});
  const nested = await Promise.all(entries.map(entry => {
    const fullPath = path.join(dir, entry.name);
    return entry.isDirectory() ? listFiles(fullPath, predicate) : (predicate(fullPath) ? [fullPath] : []);
  }));
  return nested.flat();
}

async function latestMtime(files) {
  if (files.length === 0) return 0;
  const stats = await Promise.all(files.map(file => fs.stat(file)));
  return Math.max(...stats.map(stat => stat.mtimeMs));
}

function parseMarkdownRows(markdown) {
  return markdown
    .split('\n')
    .filter(line => line.startsWith('|') && !line.includes('---'))
    .map(line => line.split('|').map(cell => cell.trim()));
}

function stripBackticks(value) {
  return value.replace(/^`|`$/g, '');
}

function extractStringLiterals(source) {
  return [...source.matchAll(/(['"`])((?:\\.|(?!\1)[\s\S])*?)\1/g)]
    .map(match => match[2]);
}

function stripModuleSpecifiers(source) {
  return source
    .replace(/from\s+(['"`])((?:\\.|(?!\1)[\s\S])*?)\1/g, 'from ""')
    .replace(/import\s*\(\s*(['"`])((?:\\.|(?!\1)[\s\S])*?)\1\s*\)/g, 'import("")');
}

await main();
