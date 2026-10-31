// The notes editor's list of related notes: one button a note, most related first, which opens it, and nothing at all
// when no note is related
import { afterEach, expect, it } from 'vitest';
import { createApp, h, type App } from 'vue';
import RelatedNotes from '#features/notes/fe/components/RelatedNotes.vue';
import type { NoteSummary } from '#generated/types.ts';

let app: App | undefined;
afterEach(() => { app?.unmount(); app = undefined; document.body.replaceChildren(); });

const summary = (id: string, title: string, icon: string | null = null) => ({ id, title, icon }) as unknown as NoteSummary;

function mount(notes: NoteSummary[]) {
  const opened: string[] = [];
  const root = document.createElement('div');
  document.body.appendChild(root);
  app = createApp({ render: () => h(RelatedNotes, { notes, onOpen: (id: string) => opened.push(id) }) });
  app.mount(root);
  return { root, opened };
}

it('lists each related note in order, and opens the one clicked', () => {
  const { root, opened } = mount([summary('Note-b', 'Beta', '📘'), summary('Note-a', '')]);
  const buttons = [...root.querySelectorAll('button')];
  expect(buttons.map((b) => b.textContent?.trim())).toEqual(['📘Beta', 'Untitled']);
  buttons[1]!.click();
  expect(opened).toEqual(['Note-a']);
});

it('shows nothing when no note is related', () => {
  const { root } = mount([]);
  expect(root.textContent?.trim()).toBe('');
  expect(root.querySelector('button')).toBeNull();
});
