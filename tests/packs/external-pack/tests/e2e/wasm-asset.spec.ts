import { test, expect } from '@apackdev/testing';

/**
 * A pack's WebAssembly module loads from its installed build, over `pack://`, inside the app.
 *
 * **This is the half of the one-VT-core goal that can kill it** (`docs/goals/goal-one-vt-core.md`,
 * Phase 0b): the broker's VT core has a WebAssembly build, and the window can only use it if a module
 * shipped by a pack can be fetched and instantiated from the revision the app actually installed. Every
 * other part of that plan is wasted if this does not work, and it cannot be answered by a unit test —
 * the protocol handler, the installed layout and the browser's WebAssembly implementation are all real
 * here and none of them is in a vitest process.
 *
 * `public/answer.wasm` is 39 bytes, hand-assembled: a module exporting one function returning 42. The
 * module's *capabilities* are not the subject — the route is. A real 828 KB core would prove nothing more
 * about the route and would put a binary in the repository.
 *
 * **The base comes from the document rather than from a guess.** A pack's stylesheet is loaded from
 * `pack://<id>/builds/<revision>/runtime/fe.css`, so the revision the app accepted is already in the DOM;
 * constructing it from a build read off disk would test a URL this app might not be serving.
 */
test('a pack ships a WebAssembly module and the window instantiates it', async ({ appPage }) => {
  const page = appPage;

  const base = await page.evaluate(() => {
    const link = document.querySelector<HTMLLinkElement>('link[href^="pack://e2e-fixture/builds/"]');
    return link?.href.replace(/[^/]+$/, '') ?? null;
  });
  expect(base, 'the fixture pack\'s stylesheet names its accepted build revision').toContain('pack://e2e-fixture/builds/');

  const loaded = await page.evaluate(async (from: string) => {
    const response = await fetch(`${from}answer.wasm`);
    const type = response.headers.get('content-type');
    // `instantiateStreaming` is the path the type matters for, and the one a core would use
    const { instance } = await WebAssembly.instantiateStreaming(response.clone());
    const buffered = await WebAssembly.instantiate(await response.arrayBuffer());
    return {
      type,
      streaming: (instance.exports.answer as () => number)(),
      buffered: (buffered.instance.exports.answer as () => number)(),
    };
  }, base!);

  // The MIME type is not cosmetic: `instantiateStreaming` refuses any other, and the whole reason
  // `application/wasm` is in the protocol's table is this call
  expect(loaded.type, 'served as application/wasm').toBe('application/wasm');
  expect(loaded.streaming, 'the module instantiated from the stream and ran').toBe(42);
  expect(loaded.buffered, 'and from a buffer, which is the fallback if streaming is ever refused').toBe(42);
});
