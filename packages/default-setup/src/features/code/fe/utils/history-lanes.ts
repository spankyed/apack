/**
 * Where each commit of a history sits in a drawn graph, row by row: the lane its dot is in, the lanes that run through
 * the row, and the lanes its parents go on in below it. A lane holds the commit it is waiting for; a commit takes the
 * lane that waits for it (the leftmost, when several do, the rest ending there), its first parent goes on in that
 * lane, and each other parent in a lane that waits for it already or a new one.
 */
export interface LaneRow {
  /** The lane of this commit's dot */
  lane: number
  /** The lanes that run from the row above into this one */
  through: number[]
  /** The lanes that run from this row into the one below: the commit's parents' and every other still waiting */
  below: number[]
  /** For each parent past the first, the lane it goes on in, which a line from the dot reaches */
  merges: number[]
  /** How many lanes the graph needs up to this row, the widest it has been */
  width: number
}

export function laneRows(commits: { hash: string; parents: string[] }[]): LaneRow[] {
  const lanes: (string | null)[] = []
  let width = 0
  const take = (hash: string): number => {
    const free = lanes.indexOf(null)
    if (free >= 0) { lanes[free] = hash; return free }
    lanes.push(hash)
    return lanes.length - 1
  }
  return commits.map(({ hash, parents }) => {
    const through = lanes.flatMap((waiting, at) => (waiting !== null ? [at] : []))
    let lane = lanes.indexOf(hash)
    if (lane < 0) lane = take(hash)
    // Every other lane that waited for this commit ends here
    lanes.forEach((waiting, at) => { if (waiting === hash && at !== lane) lanes[at] = null })
    lanes[lane] = parents[0] ?? null
    const merges = parents.slice(1).map(parent => {
      const waiting = lanes.indexOf(parent)
      return waiting >= 0 ? waiting : take(parent)
    })
    while (lanes.length > 0 && lanes[lanes.length - 1] === null) lanes.pop()
    const below = lanes.flatMap((waiting, at) => (waiting !== null ? [at] : []))
    width = Math.max(width, lane + 1, ...through.map(at => at + 1), ...below.map(at => at + 1))
    return { lane, through, below, merges, width }
  })
}
