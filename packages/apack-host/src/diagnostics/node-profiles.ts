import { Session } from 'node:inspector';
import { createPerformanceProfiles } from './profiles.ts';

/** Local Inspector session; no network listener or global debugger configuration. */
export function createNodeProfiles() {
  const session = new Session();
  session.connect();
  try { return createPerformanceProfiles({
    post: (method, parameters) => new Promise((resolve, reject) => {
      session.post(method, parameters, (error, result) => error ? reject(error) : resolve(result));
    }),
    close: () => session.disconnect(),
  }); } catch (error) { session.disconnect(); throw error; }
}
