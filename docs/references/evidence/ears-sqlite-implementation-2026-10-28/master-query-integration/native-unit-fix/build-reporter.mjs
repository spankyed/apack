import { appendFileSync } from 'node:fs';
export default class Reporter { onUserConsoleLog(log) { appendFileSync('/results/build-events.jsonl', JSON.stringify(log)+'\n'); } }
