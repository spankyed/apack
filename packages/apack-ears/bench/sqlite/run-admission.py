"""Sequential fresh-process admission loads in the disposable runner; retain failures before stopping."""
import argparse, json, pathlib, subprocess
parser=argparse.ArgumentParser()
parser.add_argument('output',type=pathlib.Path)
parser.add_argument('--durable',action='store_true')
parser.add_argument('--trials',type=int,default=3)
parser.add_argument('--sizes',type=int,nargs='+',default=[10000,100000])
args=parser.parse_args()
repo=pathlib.Path(__file__).resolve().parents[4]
args.output.mkdir(parents=True,exist_ok=True)
subprocess.run(['node','--experimental-strip-types','--test','packages/apack-ears/bench/sqlite/load-metrics.check.ts'],cwd=repo,check=True)
subprocess.run(['python3','packages/apack-ears/bench/sqlite/run-bench.py',str(args.output/'source'),'--trials','0']+(['--durable'] if args.durable else []),cwd=repo,check=True)
for trial in range(1,args.trials+1):
 for n in (args.sizes if trial%2 else list(reversed(args.sizes))):
  name=f'{n}-{trial}'
  print(f'Admission load {name}',flush=True)
  result=subprocess.run(['node','--import','tsx','packages/apack-ears/bench/sqlite/admission.ts',str(n)]+(['--durable'] if args.durable else []),cwd=repo,text=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=300)
  (args.output/f'{name}.stdout').write_text(result.stdout)
  (args.output/f'{name}.stderr').write_text(result.stderr)
  try:value=json.loads(result.stdout)
  except json.JSONDecodeError:raise RuntimeError(f'{name} produced no report: {result.stderr}')
  (args.output/f'{name}.json').write_text(json.dumps(value,indent=2)+'\n')
  if result.returncode:raise RuntimeError(f'{name} failed its recorded budgets: {result.stderr}')
