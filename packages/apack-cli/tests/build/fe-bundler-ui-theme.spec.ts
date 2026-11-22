import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { uiTailwindPreset } from '../../../apack-ui/src/tailwind-preset.ts';

// Not from @app/internal-publish-checks: importing that asserts the packages are freshly built,
// and nothing here reads them — this spec reads @apackdev/ui's source and the fixture's built CSS.
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');

/**
 * @apackdev/ui's components are Tailwind class names, and some name colours that exist only where a
 * Tailwind config defines them. Inside the app they resolve; a pack that sets `build.bundleUi` runs its
 * own Tailwind build over its own config, so without the package's preset those classes matched
 * nothing and Tailwind emitted no CSS — the component rendered with its accent missing and nothing
 * said so. The preset travels with the components to close that.
 *
 * Two things have to hold, and the first is the one that rots: the preset has to keep covering what
 * the components actually use. A new `primary-800` in a template would compile, render and ship with
 * no styling, exactly as before.
 */

const UI_SRC = path.join(REPO_ROOT, 'packages', 'apack-ui', 'src');

function sources(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) sources(full, out);
    else if (/\.(vue|ts)$/.test(entry.name)) out.push(full);
  }
  return out;
}

/** Themed colour shades the components name, as `family` → shades */
function themedShadesUsed(): Map<string, Set<string>> {
  const families = Object.keys(uiTailwindPreset.theme.extend.colors);
  const used = new Map<string, Set<string>>();
  for (const file of sources(UI_SRC)) {
    const text = fs.readFileSync(file, 'utf-8');
    for (const family of families) {
      for (const [, shade] of text.matchAll(new RegExp(`\\b[a-z-]*${family}-(\\d{2,3})\\b`, 'g'))) {
        if (!used.has(family)) used.set(family, new Set());
        used.get(family)!.add(shade);
      }
    }
  }
  return used;
}

describe("@apackdev/ui's Tailwind preset", () => {
  it('defines every shade of its own colours that the components name', () => {
    const colors = uiTailwindPreset.theme.extend.colors as Record<string, Record<string, string>>;
    const missing: string[] = [];
    for (const [family, shades] of themedShadesUsed()) {
      for (const shade of shades) {
        if (!(shade in colors[family])) missing.push(`${family}-${shade}`);
      }
    }
    expect(missing, 'classes @apackdev/ui uses that its preset does not define').toEqual([]);
  });

  it('is actually used by the components, so this spec is not vacuous', () => {
    const used = themedShadesUsed();
    expect([...used.keys()]).toContain('primary');
    expect(used.get('primary')!.size).toBeGreaterThan(0);
  });

  // The app defines the same theme through the preset rather than repeating it, so the two can't drift
  it('is what the app applies, instead of a second copy of the colours', () => {
    const config = fs.readFileSync(path.join(REPO_ROOT, 'packages', 'renderer', 'tailwind.config.ts'), 'utf-8');
    expect(config).toContain('uiTailwindPreset');
    expect(config, "the app should take @apackdev/ui's colours from the preset").not.toMatch(/primary:\s*\{/);
  });
});

/** The built fixture: a pack with build.bundleUi that renders a themed component */
const FIXTURE_CSS = path.join(REPO_ROOT, 'tests', 'packs', 'bundled-ui-pack', 'dist', 'runtime', 'fe.css');

describe.skipIf(!fs.existsSync(FIXTURE_CSS))('a built build.bundleUi pack', () => {
  it("ships CSS for @apackdev/ui's themed classes", () => {
    const css = fs.readFileSync(FIXTURE_CSS, 'utf-8');
    // The fixture renders @apackdev/ui's button with variant="primary"
    expect(css, 'the pack bundles @apackdev/ui, so its themed classes need rules').toContain('bg-primary-600');
  });
});
