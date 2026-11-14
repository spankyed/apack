// A broker a case started itself, so it holds the pid to kill.
//
// **The client under test cannot supply one.** It spawns the broker detached and releases the handle, which
// is deliberate — the broker outlives whoever started it — so a case about the broker *dying* has no pid to
// act on. `reach` connects to a listening broker before it starts another, so starting one here puts the pid
// in the case's hands without changing anything about how the code under test behaves.
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

export interface StartedBroker {
  /**
   * Ends it with no chance to say anything, which is the subject: `SIGKILL`. Resolves once it has exited.
   *
   * A broker asked politely to stop could end its sessions properly and tell their clients, which is the
   * ordinary path and not what a case about its absence is for.
   *
   * **Waited for, because a broker being killed still accepts connections.** Its listening socket takes a
   * connect into the backlog until the process is gone, so the next case would otherwise reach a broker that
   * answers nothing, and what it tested would depend on how fast the kernel reaped this one.
   */
  kill(): Promise<void>;
}

/** Starts `binary` listening on `socket`, resolving once it says it is listening */
export async function startBrokerProcess(binary: string, socket: string): Promise<StartedBroker> {
  const child = spawn(binary, [socket], { stdio: ['ignore', 'pipe', 'pipe'] });
  const said: string[] = [];
  child.stderr?.on('data', chunk => { said.push(String(chunk)); });
  const exited = new Promise<void>((resolve) => { child.once('exit', () => resolve()); });
  const lines = createInterface({ input: child.stdout! });
  await new Promise<void>((resolve, reject) => {
    const why = (text: string) => new Error(`${text}${said.length > 0 ? `: ${said.join('').trim()}` : ''}`);
    child.once('error', error => reject(why(`the broker could not be started (${error.message})`)));
    child.once('exit', code => reject(why(`the broker exited with ${code} before it was listening`)));
    // The reader re-emits its input's errors, and one with no listener is an uncaught exception
    lines.on('error', error => reject(why(`the broker's output could not be read (${error.message})`)));
    lines.once('line', line => {
      if (line.startsWith('listening ')) resolve();
      else reject(why(`the broker's first line was ${JSON.stringify(line)} rather than its socket`));
    });
  });
  return {
    async kill() {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      await exited;
    },
  };
}
