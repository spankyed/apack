import { afterEach, expect, it } from 'vitest';
import { createApp, type App } from 'vue';
import ContextUsageBlock from '#extensions/blocks/display/ContextUsageBlock.vue';
import { toContextUsageData } from '../../../src/content/actions/claude-code/_helpers/context-usage.ts';
import { nativeContextUsage } from '../../_support/claude-context.ts';

let app: App | undefined;
afterEach(() => { app?.unmount(); document.body.replaceChildren(); });

it('renders native usage as used capacity with memory and skills, excluding free/reserved space', () => {
  const root = document.createElement('div'); document.body.appendChild(root);
  app = createApp(ContextUsageBlock, { data: toContextUsageData(nativeContextUsage) }); app.mount(root);
  expect(root.textContent).toContain('fixture-model');
  expect(root.textContent).toContain('25%');
  expect(root.textContent).toContain('250 used');
  expect(root.textContent).toContain('1.0k limit');
  expect(root.textContent).toContain('System prompt');
  expect(root.textContent).toContain('Messages');
  expect(root.textContent).not.toContain('Reserved capacity');
  expect(root.textContent).not.toContain('Available capacity');
  expect(root.textContent).toContain('CLAUDE.md');
  expect(root.textContent).toContain('fixture-skill');
  const bar = root.querySelector('.h-2')!;
  expect(Array.from(bar.children).map(element => (element as HTMLElement).style.width)).toEqual(['10%', '15%']);
});
