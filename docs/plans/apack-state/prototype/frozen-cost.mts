// What a frozen list costs to read and to copy, beside the same list unfrozen. A measurement, not a check: it
// prints and refuses nothing. The kernel freezes what a state holds, so every list a handler or a component reads is
// one of these, and the draft's copy of a list is the `spread` row.
//
//   npx tsx docs/plans/apack-state/prototype/frozen-cost.mts
//
// Each figure is the least of several rounds, since a busy machine can only make a round slower.

type Row = { id: string; title: string; unread: number }
const rows = (size: number): Row[] => Array.from({ length: size }, (_, index) => ({ id: `row-${index}`, title: `Row ${index}`, unread: index % 7 }))

const WAYS: Record<string, (list: readonly Row[]) => unknown> = {
  'spread': list => [...list],
  'slice': list => list.slice(),
  'toSpliced': list => list.toSpliced(list.length >> 1, 1),
  'with': list => list.with(list.length >> 1, list[0]!),
  'filter': list => list.filter(row => row.unread > 3),
  'map': list => list.map(row => row.id),
  'find, last': list => list.find(row => row.id === `row-${list.length - 1}`),
  'for of': list => { let sum = 0; for (const row of list) sum += row.unread; return sum },
  'by index': list => { let sum = 0; for (let index = 0; index < list.length; index++) sum += list[index]!.unread; return sum },
  'spread, sort': list => [...list].sort((a, b) => a.unread - b.unread),
}

let kept: unknown
/** Nanoseconds a call, the least of the rounds. */
function cost(way: (list: readonly Row[]) => unknown, list: readonly Row[], calls: number): number {
  let least = Infinity
  for (let round = 0; round < 9; round++) {
    const from = process.hrtime.bigint()
    for (let call = 0; call < calls; call++) kept = way(list)
    least = Math.min(least, Number(process.hrtime.bigint() - from) / calls)
  }
  return least
}

for (const size of [100, 5_000]) {
  const plain = rows(size)
  const frozen = rows(size)
  for (const row of frozen) Object.freeze(row)
  Object.freeze(frozen)
  // The rows of the unfrozen list are frozen too, so that the two differ in the list alone
  for (const row of plain) Object.freeze(row)
  const calls = Math.max(20, Math.round(400_000 / size))
  for (const way of Object.values(WAYS)) { cost(way, plain, calls); cost(way, frozen, calls) }
  console.log(`\n${size} rows, nanoseconds a call`)
  console.log('way'.padEnd(14) + 'unfrozen'.padStart(12) + 'frozen'.padStart(12) + 'times'.padStart(8))
  for (const [name, way] of Object.entries(WAYS)) {
    const a = cost(way, plain, calls)
    const b = cost(way, frozen, calls)
    console.log(name.padEnd(14) + a.toFixed(0).padStart(12) + b.toFixed(0).padStart(12) + (b / a).toFixed(1).padStart(8))
  }
}
void kept
