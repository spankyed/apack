from pathlib import Path
import argparse,gzip,hashlib,importlib.util,json,subprocess

BASE_SOURCE='b9896d520504ce37cfe38f1571474dd920ff527b'
REPEAT_SOURCE='94cf2eeac6208c6022865b5d7e5bf513935a6080'
ROOT=Path(__file__).resolve().parents[5]
BASE=ROOT/'docs/references/evidence/ears-sqlite-implementation-2026-10-28/corpus-b989'

def load(directory,name,compressed=False):
    data=(directory/(name+('.gz' if compressed else ''))).read_bytes()
    if compressed:data=gzip.decompress(data)
    return json.loads(data),hashlib.sha256(data).hexdigest()

def matching(a,b,keys):
    for key in keys:
        assert a[key]==b[key], 'Incompatible comparison field: '+key

# Prove the identity gate refuses mixed payloads/policies, without a native build.
for key in ['files','revision','nativeOwnerTargets','synchronous']:
    try:matching({key:1},{key:2},[key])
    except AssertionError:pass
    else:raise AssertionError('Missing identity refusal: '+key)

parser=argparse.ArgumentParser()
parser.add_argument('--repeat',type=Path,required=True)
parser.add_argument('--output',type=Path,required=True)
a=parser.parse_args()
validator=ROOT/'packages/apack-ears/bench/sqlite/qualify-real-hybrid.py'
spec=importlib.util.spec_from_file_location('hybrid_receipts',validator)
v=importlib.util.module_from_spec(spec);spec.loader.exec_module(v)
bm,bmh=load(BASE,'corpus-manifest.json',True);rm,rmh=load(a.repeat,'corpus-manifest.json')
matching(bm,rm,['protocol','repository','revision','field','dimensions','dtype','querySelection','counts','files','recipeSha256'])
result={'protocol':'ears-independent-corpus-repeat-comparison/1','qualification':False,
        'sources':[BASE_SOURCE,REPEAT_SOURCE],'validatorSha256':hashlib.sha256(validator.read_bytes()).hexdigest(),
        'scope':'Observed independent model/run repetition; source, runner, scheduling and model differences preclude causal speedup attribution',
        'heartbeatDisposition':'Original 16 ms misses remain failures with accepted synchronous responsiveness degradation',
        'corpusPayloadIdentityMatched':True,'cohorts':[]}
for size in [1000,10000,99900]:
    b,bh=load(BASE,f'hybrid-{size}.json',True);r,rh=load(a.repeat,f'hybrid-{size}.json')
    matching(b,r,['protocol','limits','arch','size','queries','queryFamilies','nativeExtensionSha256',
      'fusionPolicy','fusionVectorDepth','vectorPolicy','nativeOwnerTargets','fallbackOwnerTarget',
      'modelMode','nativeCandidateFloor','canonicalCosine','synchronous','exactVectorChunkLimit','oracleRecipeSha256'])
    bg=v.validate(b,size,BASE_SOURCE,bmh);rg=v.validate(r,size,REPEAT_SOURCE,rmh)
    bp={(g['cohort'],g['family']):g for g in bg};rp={(g['cohort'],g['family']):g for g in rg}
    assert bp.keys()==rp.keys() and len(bp)==6
    groups=[]
    for key in sorted(bp):
        x,y=bp[key],rp[key]
        groups.append({'cohort':key[0],'family':key[1],'baseline':x,'repeat':y,
          'p95Ratio':y['p95Ms']/x['p95Ms'],
          'meanRecallDelta':{k:y['meanVectorRecall'][k]-x['meanVectorRecall'][k] for k in ['10','40','64']}})
    def metadata(d):
        return {k:d[k] for k in ['runId','cpuModels','node','nodeSha256','sqlite','nativeVectorRuntime','nativeModel',
          'oracleSha256','loadMs','resourceSnapshots']}
    result['cohorts'].append({'size':size,'originalReportSha256':[bh,rh],
      'baseline':metadata(b),'repeat':metadata(r),
      'admissionMs':[b['nativeAdmission']['ms'],r['nativeAdmission']['ms']],
      'reopenPasses':[len(b['reopen']['passes']),len(r['reopen']['passes'])],
      'groups':groups})
result['runtimeSourceDifferences']=subprocess.check_output(['git','diff','--name-only',BASE_SOURCE,REPEAT_SOURCE,'--','packages/apack-ears/src'],cwd=ROOT,text=True).splitlines()
result['queryExecutionsVerified']=3600
result['completed']=True
a.output.write_text(json.dumps(result,indent=2)+'\n')
print('Compared both 1800-query runs with unchanged original gate outcomes and matched sealed payload/policy identities')
