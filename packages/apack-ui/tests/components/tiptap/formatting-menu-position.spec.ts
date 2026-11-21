import { describe, expect, it } from 'vitest'
import { findFormattingMenuPosition } from '../../../src/components/tiptap/internal/formatting-menu-position.ts'

describe('formatting menu free space', () => {
  it('preserves an unobstructed placement', () => {
    expect(findFormattingMenuPosition({ x: 80, y: 80 }, { width: 200, height: 38 }, { x: 0, y: 0, width: 600, height: 200 }, [])).toEqual({ x: 80, y: 80 })
  })
  it('keeps compact draft, native status, hint and controls uncovered', () => {
    const obstacles = [
      { x: 112, y: 385, width: 300, height: 14 },
      { x: 112, y: 406, width: 100, height: 14 },
      { x: 112, y: 423, width: 205, height: 14 },
      { x: 112, y: 461, width: 335, height: 20 },
      { x: 112, y: 494, width: 430, height: 16 },
      { x: 110, y: 519, width: 180, height: 32 },
      { x: 607, y: 519, width: 32, height: 32 },
    ]
    const result = findFormattingMenuPosition({ x: 85, y: 486 }, { width: 218, height: 38 }, { x: 92, y: 366, width: 568, height: 192 }, obstacles)
    expect(result).toBeDefined()
    for (const r of obstacles) expect(result!.x + 218 <= r.x || result!.x >= r.x + r.width || result!.y + 38 <= r.y || result!.y >= r.y + r.height).toBe(true)
  })
  it('does not invent free space when a surface is full or smaller than the menu', () => {
    expect(findFormattingMenuPosition({ x: 0, y: 0 }, { width: 100, height: 40 }, { x: 0, y: 0, width: 90, height: 100 }, [])).toBeUndefined()
    expect(findFormattingMenuPosition({ x: 10, y: 10 }, { width: 100, height: 40 }, { x: 0, y: 0, width: 200, height: 100 }, [{ x: 0, y: 0, width: 200, height: 100 }])).toBeUndefined()
  })
})
