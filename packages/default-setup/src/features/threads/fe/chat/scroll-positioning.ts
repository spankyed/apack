/** Thread replacement can emit scroll events before its initial position has settled. */
export function createScrollPositioning(schedule: (callback: () => void) => number, cancel: (id: number) => void) {
  let generation = 0;
  let frame: number | undefined;
  let ready = false;
  const reset = () => {
    generation++;
    ready = false;
    if (frame !== undefined) cancel(frame);
    frame = undefined;
  };
  return {
    reset,
    ready: () => ready,
    position(scroll: () => void) {
      reset();
      const owner = generation;
      scroll();
      const finish = (remaining: number) => {
        frame = schedule(() => {
          if (generation !== owner) return;
          frame = undefined;
          scroll();
          if (remaining > 1) finish(remaining - 1);
          else ready = true;
        });
      };
      finish(2);
    },
  };
}
