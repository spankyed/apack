import type { ClaudeUiToolGroup } from './ui-controls.ts'
import type { ClaudeUiGroupedTool, ClaudeUiTranscriptRow } from './ui-presentation.ts'
export interface ClaudeUiToolCandidate { messageId: string; blockIndex: number; expanded: boolean; tool: ClaudeUiGroupedTool; rows: ClaudeUiTranscriptRow[]; artifact?: {artifactId:string;label:string} }
/** Anchor each canonical group once; child drawings retain their own original message identities. */
export function selectClaudeToolGroupRows(rows: ClaudeUiTranscriptRow[], candidates: ClaudeUiToolCandidate[], groups: readonly ClaudeUiToolGroup[], selected: ReadonlySet<string>): ClaudeUiTranscriptRow[] {
  const byId=new Map<string,ClaudeUiToolCandidate[]>(), ownership=new Map<string,number>()
  for(const candidate of candidates)byId.set(candidate.tool.id,[...(byId.get(candidate.tool.id)??[]),candidate])
  for(const group of groups)for(const id of group.members.map(member=>member.toolUseId))ownership.set(id,(ownership.get(id)??0)+1)
  const covered=new Set<string>(), added:ClaudeUiTranscriptRow[]=[]
  for(const group of groups){
    const ids=group.members.map(member=>member.toolUseId), revisions=new Map(group.members.map(member=>[member.toolUseId,member.revision]))
    if(!ids.length){
      const anchor=group.anchorIds.map(id=>rows.find(row=>row.uuid===id||'assistantUuid' in row&&row.assistantUuid===id||'resultUuid' in row&&row.resultUuid===id)).find(Boolean)
      if(anchor&&selected.has(anchor.messageId))added.push({component:'ToolGroup',uuid:group.id,messageId:anchor.messageId,blockIndex:-1,sessionId:anchor.sessionId,text:'',start:0,end:0,revision:group.revision,isExpanded:group.isExpanded,isActive:group.isActive,usesEngine:group.usesEngine,tools:[],artifacts:[]})
      continue
    }
    if(new Set(ids).size!==ids.length||ids.some(id=>byId.get(id)?.length!==1||ownership.get(id)!==1))continue
    const members=ids.map(id=>byId.get(id)![0]!),anchor=members[0]!
    if(!selected.has(anchor.messageId))continue
    const sessionId=anchor.rows[0]!.sessionId,expanded=group.initialized?group.isExpanded:anchor.expanded
    added.push({component:'ToolGroup',uuid:group.id,messageId:anchor.messageId,blockIndex:anchor.blockIndex,sessionId,text:'',start:0,end:0,revision:group.revision,isExpanded:expanded,isActive:group.isActive,usesEngine:group.usesEngine,tools:members.map(member=>member.tool),artifacts:[...new Map(members.filter(member=>member.artifact).map(member=>[member.artifact!.artifactId,member.artifact!])).values()]})
    for(const member of members){covered.add(member.tool.id);if(expanded&&group.usesEngine)added.push(...member.rows.map(row=>({...row,producerRevision:revisions.get(member.tool.id)!})))}
  }
  return [...rows.filter(row=>!['ToolUse','ToolResult','ToolProgress'].includes(row.component)||!covered.has(row.uuid)),...added]
}
