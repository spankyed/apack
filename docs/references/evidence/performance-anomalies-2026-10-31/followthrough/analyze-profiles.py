import json,collections,re,statistics
from pathlib import Path
root=Path('.apack/followthrough-data/followthrough-profiles-e602e9ad77')
def cpu(profile):
 nodes={n['id']:n for n in profile['nodes']};parents={c:n['id'] for n in profile['nodes'] for c in n.get('children',[])};times=collections.Counter()
 for nid,dt in zip(profile.get('samples',[]),profile.get('timeDeltas',[])):
  frame=nodes[nid]['callFrame'];times[(frame['functionName'],frame['url'],frame['lineNumber'])]+=dt/1000
 return times
def alloc(profile):
 out=collections.Counter()
 def walk(node):
  f=node['callFrame'];out[(f['functionName'],f['url'],f['lineNumber'])]+=node.get('selfSize',0)
  for c in node.get('children',[]):walk(c)
 walk(profile['head']);return out
def tops(counts,n=15):return [{'function':k[0],'url':k[1],'line':k[2]+1,'value':v} for k,v in counts.most_common(n)]
search={}
for role in ['backend','renderer']:
 c=collections.Counter();a=collections.Counter();dur=[]
 for index in range(5,25):
  report=json.loads((root/f'search-detailed/trial-{index}.json').read_text())['processes'][role]
  assert report['complete'] and report['profiles']['complete'];p=report['profiles'];c.update(cpu(json.loads(p['cpu'])));a.update(alloc(json.loads(p['allocation'])));dur.append(p['durationMs'])
 search[role]={'profiles':20,'profileWindowMedianMs':statistics.median(dur),'cpuSampledMs':sum(c.values()),'cpuTop':tops(c,30),'sampledAllocationEstimate':sum(a.values()),'allocationTop':tops(a,20)}
fresh=[]
for index in [1,2,3]:
 r=json.loads((root/f'fresh-{index}/startup.json').read_text());record={'index':index,'elapsedMs':r['elapsedMs'],'context':r['context'],'processes':{}}
 for role,report in r['processes'].items():
  p=report['profiles'];spans=[json.loads(s) for s in report['observations']];record['processes'][role]={'complete':report['complete'],'cpuUserMs':report.get('processStatistics',{}).get('cpuUserMicros',0)/1000,'cpuSystemMs':report.get('processStatistics',{}).get('cpuSystemMicros',0)/1000,'profileDurationMs':p['durationMs'],'stoppedBy':p['stoppedBy'],'cpuTop':tops(cpu(json.loads(p['cpu'])),15),'allocationTop':tops(alloc(json.loads(p['allocation'])),10),'startupSpans':[{'name':s['name'],'startTime':s['startTime'],'durationMs':s['duration'][0]*1000+s['duration'][1]/1e6} for s in spans if s['name'].startswith('app.')]}
 record['phases']=[json.loads(x) for x in re.findall(r'\[e2e.launch\]\s+(\{[^\n]+\})',(root/f'fresh-{index}.log').read_text())]
 fresh.append(record)
output={'method':'Detailed mode changes execution cost; samples include recorder lifecycle. Sampled allocation estimates are not exact allocations. No timing qualification or isolated recording-cost claim.','search':search,'fresh':fresh}
Path('.apack/followthrough-summary.json').write_text(json.dumps(output,indent=2))
for role,r in search.items():
 print('SEARCH',role,'window',r['profileWindowMedianMs'],'ms','sampled',r['cpuSampledMs']);print(json.dumps(r['cpuTop'][:10],indent=2));print('ALLOC',json.dumps(r['allocationTop'][:6]))
for r in fresh:
 print('FRESH',r['index'],r['elapsedMs'],r['context']['activeSurfaceId'])
 for role,p in r['processes'].items():print(role,p['profileDurationMs'],p['stoppedBy'],p['cpuUserMs'],json.dumps(p['startupSpans']),json.dumps(p['cpuTop'][:6]))
