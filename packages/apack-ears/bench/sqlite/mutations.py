"""Run selected negative proofs in disposable copies; never mutate the real worktree."""
import json, pathlib, shutil, subprocess, tempfile, os
here = pathlib.Path(__file__).resolve().parent
repo = here.parents[3]
mutations = [
    ('snapshot', 'const snapshot = !this.active', 'const snapshot = false', 'consistent multi-statement snapshot'),
    ('schema', 'if (Number(this.meta("schemaRevision") ?? 0) !== this.heldRevision)', 'if (false)', 'admits new types'),
    ('embeddings', '`UPDATE chunks SET embedding=', '`UPDATE chunks SET embedding=NULL WHERE 0; --', 'backs up and replaces'),
    ('commit-sequence', '        sequence,\n        touched: this.touched(unit.changes),', '        sequence: this.sequence,\n        touched: this.touched(unit.changes),', 'reports its own commit sequence'),
    ('rollback', 'else this.sql.exec("ROLLBACK");', 'else this.sql.exec("COMMIT");', 'rolls back primary'),
]
results=[]
for name, old, new, test in mutations:
    with tempfile.TemporaryDirectory(prefix='ears-sqlite-mutation-') as temp:
        root=pathlib.Path(temp)
        package=root/'packages/apack-ears'
        package.mkdir(parents=True)
        shutil.copytree(repo/'packages/apack-ears/src',package/'src')
        (package/'tests/engine').mkdir(parents=True)
        shutil.copy2(repo/'packages/apack-ears/tests/engine/sqlite-operations.spec.ts',package/'tests/engine/sqlite-operations.spec.ts')
        shutil.copy2(repo/'packages/apack-ears/package.json',package/'package.json')
        shutil.copytree(here,package/'bench/sqlite',ignore=shutil.ignore_patterns('node_modules','__pycache__'))
        (root/'node_modules').symlink_to(repo/'node_modules',target_is_directory=True)
        (package/'bench/sqlite/extensions/node_modules').symlink_to(here/'extensions/node_modules',target_is_directory=True)
        source=package/'bench/sqlite/database.ts'
        text=source.read_text()
        if text.count(old)!=1: raise RuntimeError(f'{name}: mutation anchor changed')
        source.write_text(text.replace(old,new))
        run=subprocess.run([str(repo/'node_modules/.bin/vitest'),'run','--config','bench/sqlite/vitest.config.ts','-t',test],cwd=package,env={**os.environ,'EARS_EVALUATION_BACKEND':'sqlite'},text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=60)
        # Collection/startup errors are not evidence that a behavior test detects the mutation.
        detected=run.returncode!=0 and '1 failed' in run.stdout and 'AssertionError' in run.stdout
        results.append({'mutation':name,'detected':detected,'exitCode':run.returncode,'output':run.stdout})
        if not detected: print(run.stdout);raise RuntimeError(f'{name}: negative proof did not fail meaningfully')
print(json.dumps(results,indent=2))
