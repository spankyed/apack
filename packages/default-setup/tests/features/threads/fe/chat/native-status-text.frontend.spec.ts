import { parseClaudeStatus } from '#features/threads/fe/chat/native-status-text.ts'
it('retains multiline text and carries colors and emphasis across lines until reset', () => {
  const spans = parseClaudeStatus('\x1b[31;1mMain\nSecond\x1b[0m normal')
  expect(spans).toEqual([{ text: 'Main\nSecond', style: { color: '#f87171', fontWeight: '600' } }, { text: ' normal', style: {} }])
})
it('supports indexed and truecolor native status without accepting invalid color values', () => {
  expect(parseClaudeStatus('\x1b[38;5;196mRed\x1b[48;2;1;2;3mBG')).toEqual([
    { text: 'Red', style: { color: 'rgb(255, 0, 0)' } }, { text: 'BG', style: { color: 'rgb(255, 0, 0)', backgroundColor: 'rgb(1, 2, 3)' } },
  ])
  expect(parseClaudeStatus('\x1b[38;2;999;2;3mPlain')).toEqual([{ text: 'Plain', style: {} }])
})
it('removes terminal commands and OSC links while leaving markup as inert text', () => {
  const spans = parseClaudeStatus('\x1b[2J\x1b]8;;javascript:alert(1)\x07<img onerror="bad()">\x1b]8;;\x1b\\\x00\x07')
  expect(spans).toEqual([{ text: '<img onerror="bad()">', style: {} }])
  expect(parseClaudeStatus('visible\x1b]52;c;clipboard')).toEqual([{ text: 'visible', style: {} }])
})
