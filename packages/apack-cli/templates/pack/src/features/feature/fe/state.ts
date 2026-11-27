import { state } from '#generated/state.ts';
import type { __PASCAL__Context, __PASCAL__Inbox } from './contract.ts';

// The feature's name, which this pack's code sends to and opens the surface by (`openSurface` from #generated/fe)
export const id = '__NAME__';

const __CAMEL__State = state<{ data: __PASCAL__Context }, __PASCAL__Inbox>()({
  data: { ready: false },
});

export default __CAMEL__State;
