// What an editor's command popup lists, in a window where the chat was never opened.
//
// This is the behaviour the commands goal exists for. The list used to be the threads surface's context, so it
// reached a popup through `useSurfaceState('threads', …)`: a window showing no chat had no threads actor, and `/`
// in any editor there offered nothing. The list is the app's now — whichever feature plays the `commands`
// designation serves it, the app publishes it to the shell, and `useCommandItems` reads it from there — so the
// surfaces a window happens to have decide nothing.
//
// The shell here spawns **only** the Logs surface, which is what makes this a test rather than a restatement.
import * as path from 'node:path';
import { effectScope, ref } from 'vue';
import { expect, it } from 'vitest';
import { startApp, startShell } from '@apackdev/testing/harness';
import { useCommandItems } from '@apackdev/ui/components/tiptap/composables/useCommandItems';
import { importCompiledContent } from '@apackdev/sdk/utils';
import logsState from '#features/logs/fe/state.ts';

const DIST = path.resolve(import.meta.dirname, '../../../dist', 'runtime', 'content');

it('lists every command in a window whose only surface is Logs', async () => {
  importCompiledContent({ compiledDir: DIST, include: { commands: true } });
  const app = await startApp({ systems: ['library', 'host/application', 'host/settings'] });
  // The shell before the connection, as a window is: the bus asks every system to publish when a client
  // connects, and the app's publish is what fills the shell's list
  await startShell({ surfaces: { logs: { state: logsState } } });
  await app.connect();
  await app.settle();

  const scope = effectScope();
  const query = ref('');
  const { commands } = scope.run(() => useCommandItems(query))!;

  expect(commands.value.map((command) => command.name)).toEqual(expect.arrayContaining(['pr2md', 'cc-resume', 'cc-plan', 'cc-models', 'cc-reset', 'cdx-goal']));

  // And it filters, which is the only other thing the popup asks of it
  query.value = 'pr2';
  expect(commands.value.map((command) => command.name)).toEqual(['pr2md']);

  scope.stop();
});
