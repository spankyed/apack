let fresh = 0;

/** A key no other call has, for one made beside others of its name with nothing of its own to be told apart by */
export const freshKey = (): string => `#${++fresh}`;
