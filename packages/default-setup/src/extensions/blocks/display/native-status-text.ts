export interface ClaudeStatusSpan { text: string; style: Record<string, string> }
const palette = ['#171717','#f87171','#4ade80','#facc15','#60a5fa','#c084fc','#22d3ee','#d4d4d4','#737373','#fca5a5','#86efac','#fde047','#93c5fd','#d8b4fe','#67e8f9','#fafafa']
function indexed(value: number): string | undefined {
  if (!Number.isInteger(value) || value < 0 || value > 255) return
  if (value < 16) return palette[value]
  if (value >= 232) { const gray = 8 + (value - 232) * 10; return `rgb(${gray}, ${gray}, ${gray})` }
  const levels = [0, 95, 135, 175, 215, 255], n = value - 16
  return `rgb(${levels[Math.floor(n / 36)]}, ${levels[Math.floor(n / 6) % 6]}, ${levels[n % 6]})`
}
/** Whitelisted SGR presentation only. OSC links, terminal commands and HTML never become DOM markup. */
export function parseClaudeStatus(text: string): ClaudeStatusSpan[] {
  const spans: ClaudeStatusSpan[] = []
  let style: Record<string, string> = {}, foreground: string | undefined, background: string | undefined, inverse = false
  function append(value: string) {
    const clean = value.replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, '')
    if (!clean) return
    const paint = { ...style }
    if (foreground || inverse) paint.color = inverse ? background ?? '#1c1c1c' : foreground!
    if (background || inverse) paint.backgroundColor = inverse ? foreground ?? '#d4d4d4' : background!
    spans.push({ text: clean, style: paint })
  }
  const controls = /\x1b\][\s\S]*?(?:\x07|\x1b\\)|\x1b\][\s\S]*$|\x1b\[[0-?]*[ -/]*[@-~]|\x1b./g
  let cursor = 0
  for (const match of text.matchAll(controls)) {
    append(text.slice(cursor, match.index)); cursor = match.index! + match[0].length
    if (!/^\x1b\[[0-9;]*m$/.test(match[0])) continue
    const codes = match[0].slice(2, -1).split(';').map(value => Number(value || 0))
    for (let i = 0; i < codes.length; i++) {
      const code = codes[i]!
      if (code === 0) { style = {}; foreground = background = undefined; inverse = false }
      else if (code === 1) style.fontWeight = '600'
      else if (code === 2) style.opacity = '0.65'
      else if (code === 3) style.fontStyle = 'italic'
      else if (code === 4) style.textDecoration = 'underline'
      else if (code === 7) inverse = true
      else if (code === 9) style.textDecoration = 'line-through'
      else if (code === 22) { delete style.fontWeight; delete style.opacity }
      else if (code === 23) delete style.fontStyle
      else if (code === 24 || code === 29) delete style.textDecoration
      else if (code === 27) inverse = false
      else if (code === 39) foreground = undefined
      else if (code === 49) background = undefined
      else if (code >= 30 && code <= 37) foreground = palette[code - 30]
      else if (code >= 90 && code <= 97) foreground = palette[code - 90 + 8]
      else if (code >= 40 && code <= 47) background = palette[code - 40]
      else if (code >= 100 && code <= 107) background = palette[code - 100 + 8]
      else if (code === 38 || code === 48) {
        let color: string | undefined
        if (codes[i + 1] === 5) { color = indexed(codes[i + 2]!); i += 2 }
        else if (codes[i + 1] === 2) {
          const rgb = codes.slice(i + 2, i + 5)
          if (rgb.length === 3 && rgb.every(value => Number.isInteger(value) && value >= 0 && value <= 255)) color = `rgb(${rgb.join(', ')})`
          i += 4
        }
        if (color) { if (code === 38) foreground = color; else background = color }
      }
    }
  }
  append(text.slice(cursor)); return spans
}
