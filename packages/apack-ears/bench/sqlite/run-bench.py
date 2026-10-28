"""Fresh-process, sequential trials. Do not run alongside other builds or benchmarks."""
import argparse, json, pathlib, subprocess
parser=argparse.ArgumentParser()
parser.add_argument('output',type=pathlib.Path)
parser.add_argument('--trials',type=int,default=3)
parser.add_argument('--durable',action='store_true')
args=parser.parse_args()
repo=pathlib.Path(__file__).resolve().parents[4]
args.output.mkdir(parents=True,exist_ok=True)
for trial in range(1,args.trials+1):
    for backend in (['sqlite','elmdb'] if trial%2 else ['elmdb','sqlite']):
        name=f'{backend}-{trial}'
        print(f'Running {name}, durable={args.durable}',flush=True)
        command=['node','--import','tsx','--expose-gc','packages/apack-ears/bench/sqlite/bench.ts',backend]
        if args.durable:command.append('--durable')
        result=subprocess.run(command,cwd=repo,text=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=300)
        (args.output/f'{name}.stderr').write_text(result.stderr)
        if result.returncode:raise RuntimeError(f'{name} failed: {result.stderr}')
        value=json.loads(result.stdout)
        (args.output/f'{name}.json').write_text(json.dumps(value,indent=2)+'\n')
