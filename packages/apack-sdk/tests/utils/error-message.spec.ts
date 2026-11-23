import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { errorMessage } from '../../src/utils/shared.ts';

describe('errorMessage', () => {
  it('returns the message of a standard Error and stringifies non-errors', () => {
    expect(errorMessage(new Error('boom'))).toBe('boom');
    expect(errorMessage('plain text')).toBe('plain text');
    expect(errorMessage(42)).toBe('42');
    expect(errorMessage(null)).toBe('null');
  });

  it('unwraps a SuppressedError from a using / DisposableStack double-fault', () => {
    let caught: unknown;
    try {
      using stack = new DisposableStack();
      stack.defer(() => { throw new Error('rmSync EPERM'); });
      throw new Error('manifest invalid');
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(SuppressedError);
    expect(errorMessage(caught)).toBe('manifest invalid (cleanup also failed: rmSync EPERM)');
  });

  it('unwraps nested SuppressedErrors in disposal order across DisposableStack and multiple using bindings', () => {
    let fromStack: unknown;
    try {
      using stack = new DisposableStack();
      stack.defer(() => { throw new Error('second cleanup'); });
      stack.defer(() => { throw new Error('first cleanup'); });
      throw new Error('primary failure');
    } catch (err) {
      fromStack = err;
    }
    expect(fromStack).toBeInstanceOf(SuppressedError);
    expect(errorMessage(fromStack)).toBe('primary failure (cleanup also failed: first cleanup; second cleanup)');

    let fromBindings: unknown;
    try {
      using _outer = { [Symbol.dispose]() { throw new Error('outer cleanup'); } };
      using _inner = { [Symbol.dispose]() { throw new Error('inner cleanup'); } };
      throw new Error('body failure');
    } catch (err) {
      fromBindings = err;
    }
    expect(fromBindings).toBeInstanceOf(SuppressedError);
    expect(errorMessage(fromBindings)).toBe('body failure (cleanup also failed: inner cleanup; outer cleanup)');
  });

  it('handles cross-realm Error and SuppressedError instances', () => {
    const crossError = vm.runInNewContext('new Error("from vm")');
    const crossSuppressed = vm.runInNewContext('new SuppressedError(new Error("vm close"), new Error("vm body"))');
    expect(errorMessage(crossError)).toBe('from vm');
    expect(errorMessage(crossSuppressed)).toBe('vm body (cleanup also failed: vm close)');
  });

  it('terminates cleanly on cyclic SuppressedError chains', () => {
    const cyclic = new SuppressedError(new Error('cleanup'), new Error('primary'));
    cyclic.suppressed = cyclic;
    expect(errorMessage(cyclic)).toBe('cleanup');

    const doubleCyclic = new SuppressedError(new Error('cleanup'), new Error('primary'), 'cycle fallback');
    doubleCyclic.suppressed = doubleCyclic;
    doubleCyclic.error = doubleCyclic;
    expect(errorMessage(doubleCyclic)).toBe('cycle fallback');
  });
});
