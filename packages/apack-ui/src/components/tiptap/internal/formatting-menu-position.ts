interface Rect { x: number; y: number; width: number; height: number }
interface Point { x: number; y: number }

/** Keep a floating formatting menu in free composer space without changing layout. */
export function findFormattingMenuPosition(preferred: Point, size: Pick<Rect, 'width' | 'height'>, boundary: Rect, obstacles: Rect[]): Point | undefined {
  const gap = 4
  const left = boundary.x + gap, right = boundary.x + boundary.width - size.width - gap
  const top = boundary.y + gap, bottom = boundary.y + boundary.height - size.height - gap
  if (left > right || top > bottom) return
  const overlap = (p: Point, r: Rect) => p.x < r.x + r.width + gap && p.x + size.width + gap > r.x && p.y < r.y + r.height + gap && p.y + size.height + gap > r.y
  const free = (p: Point) => p.x >= left && p.x <= right && p.y >= top && p.y <= bottom && obstacles.every(r => !overlap(p, r))
  if (free(preferred)) return preferred
  const candidates = (values: number[], min: number, max: number, origin: number) => [...new Set(values.map(value => Math.max(min, Math.min(value, max))))].sort((a, b) => Math.abs(a - origin) - Math.abs(b - origin)).slice(0, 16)
  const xs = candidates([preferred.x, left, right, ...obstacles.flatMap(r => [r.x - size.width - gap, r.x + r.width + gap])], left, right, preferred.x)
  const ys = candidates([preferred.y, top, bottom, ...obstacles.flatMap(r => [r.y - size.height - gap, r.y + r.height + gap])], top, bottom, preferred.y)
  let best: Point | undefined, distance = Infinity
  for (const x of xs) for (const y of ys) {
    const point = { x, y }, next = (x - preferred.x) ** 2 + (y - preferred.y) ** 2
    if (next < distance && free(point)) { best = point; distance = next }
  }
  return best
}
