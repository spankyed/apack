from pathlib import Path
import subprocess,hashlib,json
r=Path('/metrics');o=Path('/results');raw=(r/'packages/apack-ears/etc/index.api.md').read_bytes();normalized=Path('/normalized.api.md').read_bytes()
assert raw.replace(b'\r\n',b'\n')==normalized
(r/'packages/apack-ears/etc/index.api.md').write_bytes(normalized)
with (o/'normalized-api-check.log').open('w') as f:p=subprocess.run(['npm','run','api:check','-w','@apackdev/ears'],cwd=r,stdout=f,stderr=subprocess.STDOUT,timeout=120)
(o/'normalized-api.json').write_text(json.dumps({'generatedSha256':hashlib.sha256(raw).hexdigest(),'normalizedSha256':hashlib.sha256(normalized).hexdigest(),'transformation':'CRLF to LF only, preserving repository index.api.md line endings','args':['npm','run','api:check','-w','@apackdev/ears'],'exitCode':p.returncode},indent=2)+'\n');print('normalized-api-check',p.returncode,flush=True);assert p.returncode==0
