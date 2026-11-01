import { copyChatSelection } from '../../../../src/components/tiptap/internal/chat-copy.ts'
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from 'tiptap-markdown';
import { ReferenceNode, ReadOnlyReferences } from '../../../../src/components/tiptap/extensions/reference-node.ts';

import { startFeTestRuntime, stopFeTestRuntime } from '@apackdev/sdk/testing';
import { resolveName } from '@apackdev/sdk/ids';
import type { ReferenceCatalogEntry } from '@apackdev/sdk/framework';
import type { ReferenceBinding, ReferenceTypeConfig } from '@apackdev/sdk/fe/references';

const send = vi.fn();
const listeners = new Set<() => void>();
let entries: ReferenceCatalogEntry[];
let bindings: Map<string, ReferenceBinding<ReferenceTypeConfig>>;
let ready: boolean;
function addType(name: string) {
  const featureRef = resolveName('links', name + '-pack');
  entries.push({ packId: name + '-pack', featureRef, origin: 'native', enabled: true, declaration: {
    types: { [name]: { category: 'links', icon: 'Link', svgElements: [] } }, categories: {},
  } });
  bindings.set(name, { featureRef, binding: { category: 'links', icon: {}, svgElements: [] } });
}

const editors: Editor[] = [];
let dom: JSDOM;
beforeEach(() => {
  entries = []; bindings = new Map(); ready = true;
  addType('thread'); addType('document');
  startFeTestRuntime({ application: { send } as never, settings: {} as never, secrets: {} as never, client: {} as never,
    catalog: { frontend: () => [], artifacts: () => [], blocks: () => [], events: () => [], dsl: () => [], steps: () => [], status: () => ready ? 'ready' : 'disconnected', problem: () => undefined, references: () => entries,
      subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; } },
    packs: { referenceTypes: () => bindings } as never });
  dom = new JSDOM('<!doctype html><html><body></body></html>');
  // Keep Node's TextEncoder/Uint8Array realm intact for the pack's esbuild harness.
  for (const key of ['window', 'document', 'DOMParser', 'HTMLElement', 'Node', 'MutationObserver', 'MouseEvent', 'getComputedStyle'] as const)
    vi.stubGlobal(key, key === 'window' ? dom.window : dom.window[key]);
});
afterEach(() => { for (const editor of editors.splice(0)) editor.destroy(); dom.window.close(); stopFeTestRuntime(); expect(listeners.size).toBe(0); vi.unstubAllGlobals(); vi.clearAllMocks(); });
const editor = (content: object | string) => {
  const element = document.createElement('div'); document.body.appendChild(element);
  const instance = new Editor({ element, editable: false, extensions: [StarterKit, Markdown, ReferenceNode], content });
  editors.push(instance); return instance;
};
const reference = (id: string | null, refType = 'thread', label = 'Friendly label', shortCode = 'THR-12') => ({
  type: 'reference', attrs: { refType, refId: id, shortCode, label },
});
const content = (...references: ReturnType<typeof reference>[]) => ({ type: 'doc', content: [{ type: 'paragraph', content: references }] });
const attrs = (instance: Editor) => {
  const found: Record<string, unknown>[] = [];
  instance.state.doc.descendants(node => { if (node.type.name === 'reference') found.push(node.attrs); });
  return found;
};
const markdown = (instance: Editor): string => (instance.storage as unknown as { markdown: { getMarkdown(): string } }).markdown.getMarkdown();

it.each([['thread', 'Thread-first', 'THR-12'], ['document', 'Document-first', 'DOC-12']])(
  'keeps the %s entity id through HTML and Markdown instead of its display code', (type, id, code) => {
    const original = editor(content(reference(id, type, 'Friendly label', code)));
    const href = `apack-ref://${type}/${id}`;
    expect(original.getHTML()).toContain(`href="${href}"`);
    expect(attrs(editor(original.getHTML()))).toMatchObject([{ refId: id, shortCode: code, label: 'Friendly label' }]);
    expect(markdown(original)).toBe(`[Friendly label](${href})`);
    const restored = editor(markdown(original));
    expect(attrs(restored)).toMatchObject([{ refId: id, label: 'Friendly label' }]);
    restored.view.dom.querySelector('.reference-pill')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(send).toHaveBeenCalledWith({ type: 'OPEN_ENTITY', id });
  },
);

it('keeps distinct ids when two references share a short code', () => {
  const original = editor(content(reference('Thread-one'), reference('Thread-two')));
  expect(attrs(editor(markdown(original))).map(value => value.refId)).toEqual(['Thread-one', 'Thread-two']);
});

it('encodes targets once and escapes punctuation in visible Markdown labels', () => {
  const id = 'Thread-a/(part)#value %'; const label = 'A [label] with \\ punctuation';
  const original = editor(content(reference(id, 'thread', label)));
  expect(markdown(original)).toContain('apack-ref://thread/Thread-a%2F%28part%29%23value%20%25');
  expect(attrs(editor(markdown(original)))).toMatchObject([{ refId: id, label }]);
  expect(attrs(editor(original.getHTML()))).toMatchObject([{ refId: id, label }]);
});

it.each(['apack-ref://thread/', 'apack-ref://thread/Thread-%ZZ'])('refuses an empty or malformed encoded target %s', href => {
  expect(attrs(editor(`<p><a href="${href}">Bad reference</a></p>`))).toEqual([]);
});

it('opens canonical entity IDs independently of reference type and ignores missing IDs', () => {
  const original = editor(content(reference('Thread-one', 'unknown'), reference(null)));
  expect(original.getHTML()).toContain('apack-ref://unknown/Thread-one');
  expect(markdown(original)).toContain('apack-ref://unknown/Thread-one');
  for (const node of original.view.dom.querySelectorAll('.reference-pill')) node.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  expect(send).toHaveBeenCalledExactlyOnceWith({ type: 'OPEN_ENTITY', id: 'Thread-one' });
});

it('delivers the updated target from an existing node view', () => {
  const original = editor(content(reference('Thread-one')));
  const view = original.view.dom.querySelector('.reference-pill')!;
  original.commands.setNodeSelection(1);
  original.commands.updateAttributes('reference', { refId: 'Thread-two', label: 'Updated label' });
  expect(original.view.dom.querySelector('.reference-pill')).toBe(view);
  expect(view.textContent).toBe('Updated label');
  view.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  expect(send).toHaveBeenCalledWith({ type: 'OPEN_ENTITY', id: 'Thread-two' });
});

it('parses a new external reference in an already-created editor without starting or rebuilding it', () => {
  const opened = editor('<p>Open before contribution</p>');
  addType('memo');
  opened.commands.setContent('<p><a href="apack-ref://memo/Memo-one">Memo</a></p>');
  expect(attrs(opened)).toMatchObject([{ refType: 'memo', refId: 'Memo-one' }]);
  expect(markdown(opened)).toBe('[Memo](apack-ref://memo/Memo-one)');
  expect(send).not.toHaveBeenCalled();
  opened.view.dom.querySelector('.reference-pill')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  expect(send).toHaveBeenCalledWith({ type: 'OPEN_ENTITY', id: 'Memo-one' });
});

it('refreshes presentation and requests opening independently of reference bindings', () => {
  const opened = editor(content(reference('Thread-one')));
  const pill = opened.view.dom.querySelector('.reference-pill')!;
  entries = entries.map(entry => entry.packId === 'thread-pack' ? { ...entry, declaration: { ...entry.declaration,
    types: { thread: { ...entry.declaration.types.thread, svgElements: [['path', { d: 'M2 4h8' }]] } } } } : entry);
  const notified = [...listeners];
  for (const listener of notified) listener();
  expect(pill.querySelector('path')?.getAttribute('d')).toBe('M2 4h8');
  ready = false;
  pill.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  expect(send).toHaveBeenLastCalledWith({ type: 'OPEN_ENTITY', id: 'Thread-one' });
  expect(opened.getHTML()).toContain('apack-ref://thread/Thread-one');
  ready = true; bindings.delete('thread');
  pill.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  expect(send).toHaveBeenCalledTimes(2);
});

it('retired node views release navigation handlers as well as declaration listeners', () => {
  const opened = editor(content(reference('Thread-one')));
  const retired = opened.view.dom.querySelector('.reference-pill')!;
  opened.commands.setContent('<p>Reference removed</p>');
  expect(listeners.size).toBe(0);
  retired.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  expect(send).not.toHaveBeenCalled();
});

it.each(['html', 'markdown'] as const)('preserves a cold %s target and updates presentation without replacing document state', format => {
  entries = []; bindings.clear(); ready = false;
  const href = 'apack-ref://memo/Memo-before-catalog';
  const opened = editor(format === 'html' ? `<p><a href="${href}">Saved memo</a></p>` : `[Saved memo](${href})`);
  expect(attrs(opened)).toMatchObject([{ refType: 'memo', refId: 'Memo-before-catalog' }]);
  expect(markdown(opened)).toBe(`[Saved memo](${href})`);
  const state = opened.state;
  const node = opened.view.dom.querySelector('.reference-pill')!;
  addType('memo');
  entries = entries.map(entry => ({ ...entry, declaration: { ...entry.declaration,
    types: { memo: { ...entry.declaration.types.memo, svgElements: [['path', { d: 'M2 4h8' }]] } } } }));
  const notified = [...listeners]; for (const listener of notified) listener();
  expect(opened.state).toBe(state);
  expect(opened.view.dom.querySelector('.reference-pill')).toBe(node);
  expect(node.querySelector('path')?.getAttribute('d')).toBe('M2 4h8');
  node.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  expect(send).toHaveBeenCalledWith({ type: 'OPEN_ENTITY', id: 'Memo-before-catalog' });
  ready = true;
  node.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  expect(send).toHaveBeenCalledWith({ type: 'OPEN_ENTITY', id: 'Memo-before-catalog' });
  entries = []; bindings.clear();
  expect(markdown(opened)).toBe(`[Saved memo](${href})`);
  expect(opened.getHTML()).toContain(href);
});

it('keeps ordinary web/mail links separate from internal references', () => {
  entries = []; bindings.clear(); ready = false;
  const opened = editor('<p><a href="https://example.com/a">Web</a> <a href="mailto:hello@example.com">Mail</a></p>');
  expect(attrs(opened)).toEqual([]);
  expect(opened.getHTML()).toContain('https://example.com/a');
  expect(opened.getHTML()).toContain('mailto:hello@example.com');
});


it('preserves read-only reference navigation and metadata updates, then releases all callbacks', () => {
  const root = document.createElement('div');
  root.innerHTML = '<p><a href="apack-ref://thread/Thread-one">Saved thread</a></p>';
  const cleanup = ReadOnlyReferences.decorate!(root);
  const pill = root.querySelector('.reference-pill')!;
  const label = pill.querySelector('.reference-pill-label')!.firstChild;
  document.body.appendChild(root);
  const range = document.createRange(); range.selectNodeContents(root);
  const selection = document.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
  const copied = new Map<string, string>();
  copyChatSelection({ clipboardData: { setData: (type: string, value: string) => copied.set(type, value) }, preventDefault() {} } as unknown as ClipboardEvent,
    root, [{ packId: 'host', groupId: 'references', binding: { extensions: { reference: ReferenceNode } } }]);
  expect(copied.get('text/plain')).toBe('[Saved thread](apack-ref://thread/Thread-one)');
  selection.removeAllRanges();
  try {
    pill.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(send).toHaveBeenCalledWith({ type: 'OPEN_ENTITY', id: 'Thread-one' });
    entries = entries.map(entry => entry.packId === 'thread-pack' ? { ...entry, declaration: { ...entry.declaration,
      types: { thread: { ...entry.declaration.types.thread, svgElements: [['path', { d: 'M2 4h8' }]] } } } } : entry);
    for (const listener of [...listeners]) listener();
    expect(pill.querySelector('path')?.getAttribute('d')).toBe('M2 4h8');
    expect(pill.querySelector('.reference-pill-label')!.firstChild).toBe(label);
  } finally { if (typeof cleanup === 'function') cleanup(); }
  send.mockClear();
  pill.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  expect(send).not.toHaveBeenCalled();
  expect(listeners.size).toBe(0);
});
