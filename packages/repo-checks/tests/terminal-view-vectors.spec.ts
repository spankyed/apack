// The view protocol's two halves are in two repositories: `apack-terminal` encodes what a view is sent in
// Rust, and `apack-terminal-view` decodes it in TypeScript. Each suite holds its half to a file of vectors —
// every kind of message as bytes and as the value they mean — which the broker writes from its encoder
// and the view carries a copy of.
//
// Neither repository can see the other's copy, so each suite passes against its own while the two have
// drifted apart: a frame gains a field in the broker, its vectors are re-recorded, and the view goes on
// passing against the file from before. This repository pins a commit of each, which makes it the one
// place both copies are on disk at the commits that will run together.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT } from '@apackdev/host/build/packages-built';

const BROKERS = path.join(REPO_ROOT, 'vendor/apack-terminal/node/view-vectors.json');
const VIEWS = path.join(REPO_ROOT, 'vendor/apack-terminal-view/tests/vectors/view-vectors.json');

/** A copy's text, or a refusal that says which link is missing and how to make it */
function read(file: string, link: string): string {
  if (!fs.existsSync(file)) {
    throw new Error(`${path.relative(REPO_ROOT, file)} is not there: run \`npm run ${link}\`, which links the checkout it is in`);
  }
  return fs.readFileSync(file, 'utf8');
}

describe('the view protocol’s vectors', () => {
  it('are one file in the two repositories that implement it, at the commits pinned here', () => {
    const brokers = read(BROKERS, 'link:apack-terminal');
    const views = read(VIEWS, 'link:apack-terminal-view');
    // Compared as the vectors they are, so the failure names the message that differs rather than a byte offset
    expect(JSON.parse(views), 'apack-terminal-view was tested against vectors the pinned broker no longer writes: '
      + 'copy vendor/apack-terminal/node/view-vectors.json to its tests/vectors/, make its suite pass, and pin that commit')
      .toEqual(JSON.parse(brokers));
    expect(views).toBe(brokers);
  });

  // An empty file agrees with an empty file
  it('cover messages in both directions', () => {
    const vectors = JSON.parse(read(BROKERS, 'link:apack-terminal')) as Array<{ to: string }>;
    expect(vectors.filter(({ to }) => to === 'view').length).toBeGreaterThan(5);
    expect(vectors.filter(({ to }) => to === 'broker').length).toBeGreaterThan(5);
  });
});
