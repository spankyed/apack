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
   * Ends it with no chance to say anything, which is the subject: `SIGKILL`.
   *
   * A broker asked politely to stop could end its sessions properly and tell their clients, which is the
   * ordinary path and not what a case about its absence is for.
   */
  kill(): void;
}

/** Starts `binary` listening on `socket`, resolving once it says it is listening */
export async function startBrokerProcess(binary: string, socket: string): Promise<StartedBroker> {
  const child = spawn(binary, [socket], { stdio: ['ignore', 'pipe', 'pipe'] });
  const said: string[] = [];
  child.stderr?.on('data', chunk => { said.push(String(chunk)); });
  const lines = createInterface({ input: child.stdout! });
  await new Promise<void>((resolve, reject) => {
    const why = (text: string) => new Error(`${text}${said.length > 0 ? `: ${said.join('').trim()}` : ''}`);
    child.once('error', error => reject(why(`the broker could not be started (${error.message})`)));
    child.once('exit', code => reject(why(`the broker exited with ${code} before it was listening`)));
    lines.once('line', line => {
      if (line.startsWith('listening ')) resolve();
      else reject(why(`the broker's first line was ${JSON.stringify(line)} rather than its socket`));
    });
  });
  return { kill() { child.kill('SIGKILL'); } };
}
