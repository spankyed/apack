import hashlib,json,sqlite3,statistics,time
runs=[]
for shape in ['numeric','hash-suffix']:
    ids=['Row-'+(str(i) if shape=='numeric' else hashlib.sha256(str(i).encode()).hexdigest()[:20]) for i in range(10000)]
    rows=[(id,'Row',i*3+1,int(i%11==0),None if i%3 else 'ROW-'+str(i))for i,id in enumerate(ids)]
    stores={}; insertion={}
    for variant in ['rowid','sequence-rowid']:
        db=sqlite3.connect(':memory:');db.execute('PRAGMA foreign_keys=ON')
        db.executescript(('CREATE TABLE entities(id TEXT PRIMARY KEY,type TEXT NOT NULL,seq INTEGER NOT NULL UNIQUE,trashed INTEGER NOT NULL,short_code TEXT UNIQUE)' if variant=='rowid' else 'CREATE TABLE entities(id TEXT NOT NULL UNIQUE,type TEXT NOT NULL,seq INTEGER PRIMARY KEY NOT NULL,trashed INTEGER NOT NULL,short_code TEXT UNIQUE)')+'; CREATE INDEX entity_type ON entities(type,trashed,seq); CREATE INDEX entity_admission ON entities(type,seq);')
        at=time.perf_counter();db.executemany('INSERT INTO entities VALUES (?,?,?,?,?)',rows);db.commit();insertion[variant]=(time.perf_counter()-at)*1000;stores[variant]=db
    tasks={
      'point-catalog':('SELECT e.id,e.type FROM json_each(?) seed JOIN entities e ON e.id=seed.value ORDER BY seed.key',lambda i:(json.dumps([ids[(i*7919)%len(ids)]]),),1000),
      'owner-to-id':('SELECT id FROM entities WHERE seq IN (SELECT value FROM json_each(?))',lambda i:(json.dumps([j*3+1 for j in range(0,10000,10)]),),10),
      'live-page-50':("SELECT id FROM entities WHERE type='Row' AND trashed=0 ORDER BY seq LIMIT 50",lambda i:(),100),
      'scoped-owner-1000':('SELECT e.seq FROM entities e WHERE e.id IN (SELECT p.id FROM json_each(?) j JOIN entities p ON p.id=j.value WHERE p.trashed=0) ORDER BY e.seq',lambda i:(json.dumps(ids[::10]),),10),
    }
    results={}
    for name,(sql,args,iterations)in tasks.items():
        answers={v:db.execute(sql,args(1)).fetchall()for v,db in stores.items()};assert answers['rowid']==answers['sequence-rowid']
        trials={v:[]for v in stores};plans={};steps={}
        for variant,db in stores.items():
            plans[variant]=[row[3]for row in db.execute('EXPLAIN QUERY PLAN '+sql,args(1))]
            count=[0]
            def progress():count[0]+=1;return 0
            db.set_progress_handler(progress,1);db.execute(sql,args(1)).fetchall();db.set_progress_handler(None,0);steps[variant]=count[0]
            for i in range(10):db.execute(sql,args(i)).fetchall()
        for trial in range(3):
            for variant in (['rowid','sequence-rowid']if trial%2==0 else ['sequence-rowid','rowid']):
                at=time.perf_counter()
                for i in range(iterations):stores[variant].execute(sql,args(i)).fetchall()
                trials[variant].append((time.perf_counter()-at)*1e6/iterations)
        results[name]={'plans':plans,'vmInstructions':steps,'samplesUs':trials,'rows':len(answers['rowid'])}
    sizes={v:db.execute('PRAGMA page_count').fetchone()[0]*db.execute('PRAGMA page_size').fetchone()[0]for v,db in stores.items()}
    runs.append({'shape':shape,'rows':len(rows),'catalogBytes':sizes,'insertMs':insertion,'queries':results})
    for db in stores.values():db.close()
report={'scope':'10k-row in-memory catalog-only SQLite control with sparse stable sequences; Python binding, not EARS/better-sqlite3/production performance qualification','sqlite':sqlite3.sqlite_version,'groups':runs}
with open('/private/tmp/ears-catalog-sequence-results.json','w')as f:json.dump(report,f,indent=2)
for group in runs:
 print(group['shape'],'bytes',group['catalogBytes'])
 for name,r in group['queries'].items():print(name,'instructions',r['vmInstructions'],'medianUs',{k:round(statistics.median(v),2)for k,v in r['samplesUs'].items()})
