import { ROOT_CONTEXT, type Context, type ContextManager } from '@opentelemetry/api';

/** Browser callbacks restore explicit carriers; this manager scopes synchronous execution only. */
export class BrowserRecordingContext implements ContextManager {
  private context = ROOT_CONTEXT;
  active(): Context { return this.context; }
  with<A extends unknown[], F extends (...args: A) => ReturnType<F>>(context: Context, fn: F, thisArg?: ThisParameterType<F>, ...args: A): ReturnType<F> {
    const previous = this.context;
    this.context = context;
    try { return fn.apply(thisArg, args); } finally { this.context = previous; }
  }
  bind<T>(context: Context, target: T): T {
    if (typeof target !== 'function') return target;
    const manager = this;
    return function(this: unknown, ...args: unknown[]) { return manager.with(context, target as (...args: unknown[]) => unknown, this, ...args); } as T;
  }
  enable(): this { return this; }
  disable(): this { this.context = ROOT_CONTEXT; return this; }
}
