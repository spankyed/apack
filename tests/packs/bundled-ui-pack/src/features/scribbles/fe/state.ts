import { state } from '#generated/state.ts';

export const id = 'scribbles' as const;

const scribblesState = state()({});

export default scribblesState;
