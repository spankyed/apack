import { projectClaudeThemePreview } from '#features/threads/fe/chat/native-theme-preview.ts'

it('keeps original patch text and token colors while discarding terminal dividers, gutters and padding',()=>{
 const result=projectClaudeThemePreview([' sample() {','-  oldValue();','+  newValue();',' }'],'────────────\n 1  sample() {\n 2 -  \u001b[31moldValue\u001b[0m();       \n 2 +  \u001b[32mnewValue\u001b[0m();       \n 3  }\n────────────\n Native syntax caption')!
 expect(result.map(row=>row.kind)).toEqual([' ','-','+',' '])
 expect(result.map(row=>row.spans.map(span=>span.text).join(''))).toEqual(['sample() {','  oldValue();','  newValue();','}'])
 expect(result[1]!.spans.find(span=>span.text==='oldValue')?.style.color).toBe('#f87171')
 expect(result[2]!.spans.find(span=>span.text==='newValue')?.style.color).toBe('#4ade80')
})
it('refuses unmatched painted content and does not mistake a border or caption for a blank source row',()=>{
 expect(projectClaudeThemePreview([' missing()'],' 1  different()')).toBeUndefined()
 expect(projectClaudeThemePreview([' '],'──────────\n Caption')).toBeUndefined()
 expect(projectClaudeThemePreview([' '],' 3  ')).toEqual([{kind:' ',spans:[]}])
})
