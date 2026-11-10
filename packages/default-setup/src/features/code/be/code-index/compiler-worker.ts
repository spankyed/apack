// The code index's compiler layer, run in a worker thread so a TypeScript program over a whole checkout never holds the
// API's event loop. It keeps one project per checkout between asks; the main thread tells it what moved and asks what
// each site of some files names (`compiler-client.ts`).
import { parentPort } from 'node:worker_threads';
import { createCompilerProject, type CompilerAnswer } from './compiler.ts';

export type CompilerRequest =
  | { id: number; type: 'open'; root: string; files: string[] }
  | { id: number; type: 'changed'; root: string; changes: { path: string; gone?: boolean }[] }
  | { id: number; type: 'answers'; root: string; files: string[] };

export type CompilerResponse =
  | { id: number; ok: true; answers?: Record<string, CompilerAnswer[] | null> }
  | { id: number; ok: false; message: string };

const projects = new Map<string, ReturnType<typeof createCompilerProject>>();

parentPort?.on('message', (request: CompilerRequest) => {
  const reply = (response: CompilerResponse) => parentPort!.postMessage(response);
  try {
    if (request.type === 'open') {
      projects.set(request.root, createCompilerProject(request.root, request.files));
      return reply({ id: request.id, ok: true });
    }
    const project = projects.get(request.root);
    if (!project) return reply({ id: request.id, ok: false, message: `No project is open at ${request.root}` });
    if (request.type === 'changed') {
      project.changed(request.changes);
      return reply({ id: request.id, ok: true });
    }
    const answers: Record<string, CompilerAnswer[] | null> = {};
    for (const file of request.files) answers[file] = project.answers(file);
    reply({ id: request.id, ok: true, answers });
  } catch (error) {
    reply({ id: request.id, ok: false, message: error instanceof Error ? error.message : String(error) });
  }
});
