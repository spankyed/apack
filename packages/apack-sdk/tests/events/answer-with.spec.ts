import { describe, expect, it } from 'vitest';
import { answerWith } from '../../src/events/index.ts';

type Answer = { type: 'LOADED'; value: string } | { type: 'FAILED'; error: string };

/** An asker that records what it was told, and what was said of a failure nobody asked about */
function asking() {
  const heard: Answer[] = [];
  const unasked: unknown[] = [];
  const options = {
    failed: (error: unknown): Answer => ({ type: 'FAILED', error: (error as Error).message }),
    unasked: (error: unknown) => { unasked.push(error); },
  };
  return { heard, unasked, options, reply: (event: Answer) => { heard.push(event); } };
}

const loaded: Answer = { type: 'LOADED', value: 'contents' };

describe('answerWith', () => {
  it('answers with what synchronous work made, before it returns', () => {
    const { heard, reply, options } = asking();
    void answerWith(reply, () => loaded, options);
    expect(heard).toEqual([loaded]);
  });

  it('answers with what asynchronous work made, once it has', async () => {
    const { heard, reply, options } = asking();
    const answering = answerWith(reply, async () => loaded, options);
    expect(heard).toEqual([]);
    await answering;
    expect(heard).toEqual([loaded]);
  });

  it.each([
    ['throws', () => { throw new Error('refused'); }],
    ['rejects', async (): Promise<Answer> => { throw new Error('refused'); }],
  ])('answers the asker when the work %s, and tells nobody else', async (_, work) => {
    const { heard, unasked, reply, options } = asking();
    await answerWith(reply, work, options);
    expect(heard).toEqual([{ type: 'FAILED', error: 'refused' }]);
    expect(unasked).toEqual([]);
  });

  it('does the work when nobody asked, and says nothing of work that was done', async () => {
    const { unasked, options } = asking();
    let done = false;
    await answerWith<Answer>(undefined, async () => { done = true; return loaded; }, options);
    expect(done).toBe(true);
    expect(unasked).toEqual([]);
  });

  it('hands a failure nobody asked about to whoever takes those, with what was thrown', async () => {
    const { unasked, options } = asking();
    const refused = new Error('refused');
    await answerWith<Answer>(undefined, async () => { throw refused; }, options);
    expect(unasked).toEqual([refused]);
  });

  it('does not answer a second time when answering itself throws', async () => {
    const { options } = asking();
    let asked = 0;
    const answering = answerWith<Answer>(() => { asked++; throw new Error('the bus is gone'); }, async () => loaded, options);
    await expect(answering).rejects.toThrow('the bus is gone');
    expect(asked).toBe(1);
  });
});
