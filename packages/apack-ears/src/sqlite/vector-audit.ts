// Compare pinned vec1 storage against canonical chunk ownership on an immutable private snapshot.
import { createHash } from 'node:crypto';
import type { SqliteDatabase } from './database.ts';
import { nativeVectorTriggers } from './vector-index.ts';

const canonicalSql=(sql:string)=>sql.replace(/\s+/g,' ').trim().replace(/;$/,'');
export function auditNativeVectors(db:SqliteDatabase,issue:(message:string)=>void):number {
  const exists=(name:string)=>!!db.get("SELECT 1 FROM sqlite_schema WHERE type='table' AND name=?",[name]);
  if(!exists('vector_indexes')) {
    if(db.get("SELECT 1 FROM sqlite_schema WHERE type='table' AND name GLOB 'ann_[0-9]*' LIMIT 1"))issue('Native projection exists without its catalog');
    return 0;
  }
  const known=new Set<string>();let compared=0;
  for(const row of db.statement('SELECT id,generation,state,after_id,model_sha256 FROM vector_indexes ORDER BY id').iterate()) {
    const model=row as {id:number;generation:number;state:string;after_id:number;model_sha256:string};
    if(!Number.isSafeInteger(model.id)||model.id<1||!Number.isSafeInteger(model.generation)||model.generation<1||
      !Number.isSafeInteger(model.after_id)||model.after_id<0||!['building','ready','retiring'].includes(model.state)) {
      issue('Invalid native projection catalog record');continue;
    }
    const name='ann_'+model.id;known.add(name);compared++;
    const missing=[name,name+'_base',name+'_model'].filter(table=>!exists(table));
    if(missing.length){issue(`${name}: missing native storage ${missing.join(', ')}`);continue;}
    const bytes=db.get(`SELECT val FROM ${name}_model WHERE id=1`)?.val;
    if(!(bytes instanceof Uint8Array)||createHash('sha256').update(bytes).digest('hex')!==model.model_sha256)
      issue(`${name}: native model hash differs from its catalog`);
    const triggers=db.all("SELECT name,sql FROM sqlite_schema WHERE type='trigger' AND name IN (?,?,?,?)",
      ['insert','update','delete','trash'].map(suffix=>name+'_'+suffix));
    if(model.state==='retiring') {
      if(triggers.length)issue(`${name}: retired projection retains foreground triggers`);
      continue;
    }
    const expectedTriggers=nativeVectorTriggers(model.id,model.generation);
    if(triggers.length!==4||expectedTriggers.some(sql=>!triggers.some(trigger=>canonicalSql(String(trigger.sql))===canonicalSql(sql))))
      issue(`${name}: native foreground triggers differ from their contract`);
    const job=db.get("SELECT kind,state FROM index_builds WHERE generation=?",[model.generation]);
    const retired=!job&&!!db.get("SELECT 1 FROM index_gc WHERE generation=? AND kind='vector'",[model.generation]);
    if((!job&&!retired)||(job&&job.kind!=='vector'))issue(`${name}: native projection has no logical vector generation`);
    if(model.state==='ready'&&job&&job.state!=='ready')issue(`${name}: ready native model has an incomplete logical generation`);
    // Ready groups must contain the full canonical set. Building groups may additionally contain writes
    // captured ahead of their cursor, but every row already visited must be present and every row must agree.
    const expected=`SELECT v.id,coalesce(p.normalized,v.embedding) vector,e.seq owner,1-e.trashed active
      FROM chunks c JOIN embedding_values v ON v.id=c.embedding_id JOIN entities e ON e.id=c.entity_id
      LEFT JOIN embedding_search p ON p.embedding_id=v.id WHERE c.generation=?`;
    if(db.get(`WITH expected AS (${expected}) SELECT 1 FROM ${name}_base a LEFT JOIN expected x ON x.id=a.id
      WHERE x.id IS NULL OR a.vector IS NOT x.vector OR a.c0 IS NOT x.owner OR a.c1 IS NOT x.active LIMIT 1`,[model.generation]))
      issue(`${name}: native rows differ from canonical embeddings or owner visibility`);
    if(db.get(`WITH expected AS (${expected}) SELECT 1 FROM expected x LEFT JOIN ${name}_base a ON a.id=x.id
      WHERE a.id IS NULL AND (?='ready' OR x.id<=?) LIMIT 1`,[model.generation,model.state,model.after_id]))
      issue(`${name}: native projection is missing canonical embeddings`);
  }
  for(const row of db.statement("SELECT name FROM sqlite_schema WHERE type='table' AND name GLOB 'ann_[0-9]*' ORDER BY name").iterate()) {
    const name=String((row as {name:string}).name);
    const owner=/^(ann_[0-9]+)(?:_(?:base|model|idx|meta|config))?$/.exec(name)?.[1];
    if(owner&&!known.has(owner))issue(`${name}: native projection has no catalog owner`);
  }
  return compared;
}
