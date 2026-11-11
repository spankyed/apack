// How far along a push, a pull, a fetch or a checkout is, read from what git prints while it works. Asked for
// progress, git writes lines such as `Writing objects:  42% (3/7)` to its error stream, each one over the last.
import type { GitProgress } from '../types.ts'

/** A line of progress: what git is doing, and how far through it is. A remote's own are prefixed with `remote: ` */
const PROGRESS = /^(?:remote: )?([A-Z][A-Za-z ]+):\s+(\d{1,3})% \((\d+)\/(\d+)\)/

/**
 * Reads git's error stream as it arrives and reports each step forward: a stage, and the percent of it done.
 * Git repeats a line when a stage ends, and a chunk can end in the middle of one, so only whole lines are read
 * and only a change is reported.
 */
export function progressReader(report: (progress: GitProgress) => void): (chunk: string) => void {
  let partial = ''
  let last = ''
  return (chunk) => {
    const lines = (partial + chunk).split(/[\r\n]/)
    partial = lines.pop() ?? ''
    for (const line of lines) {
      const read = PROGRESS.exec(line)
      if (!read) continue
      const progress = { stage: read[1]!.trim(), percent: Math.min(100, Number(read[2])) }
      const key = `${progress.stage} ${progress.percent}`
      if (key === last) continue
      last = key
      report(progress)
    }
  }
}

/** What git printed to its error stream without the progress in it, which is what there is to say of a failure */
export function withoutProgress(printed: string): string {
  return printed.split(/[\r\n]/)
    .filter(line => line.trim() !== '' && !PROGRESS.test(line) && !/^(?:remote: )?(Enumerating objects|Total|Delta compression)\b/.test(line))
    .join('\n')
}
