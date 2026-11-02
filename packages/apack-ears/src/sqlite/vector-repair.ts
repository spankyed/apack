// Only explicit owned rebuild may discard a damaged derived group; primary data never lives here.
import type { SqliteDatabase } from './database.ts';
import { auditNativeVectors } from './vector-audit.ts';

export function repairNativeVectors(db:SqliteDatabase):void {
  if(!db.sql.inTransaction)throw Object.assign(new Error('Native repair requires the rebuild transaction'),{code:'UNIT_REQUIRED'});
  db.indexBuilds.assertNativeMaintenanceOwnership();
  const tables=new Map(db.all("SELECT name,sql FROM sqlite_schema WHERE type='table' AND lower(name) GLOB 'ann_[0-9]*' ORDER BY name").map(row=>[String(row.name).toLowerCase(),row]));
  const groups=new Set<number>();
  for(const row of tables.values()) {
    const match=/^ann_([0-9]+)(?:_(?:base|model|idx|meta|config))?$/.exec(String(row.name).toLowerCase());
    if(match){const id=Number(match[1]);if(!Number.isSafeInteger(id)||id<1||String(id)!==match[1])throw Object.assign(new Error('Invalid native table identity'),{code:'CORRUPT'});groups.add(id);}
  }
  const catalog=!!db.get("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='vector_indexes'");
  if(!catalog&&!groups.size)return;
  const damaged=new Set<number>(),unscoped:string[]=[];
  auditNativeVectors(db,(message,id)=>{if(id!==undefined&&Number.isSafeInteger(id)&&id>0)damaged.add(id);else unscoped.push(message);});
  if(!catalog)for(const id of groups)damaged.add(id);
  else if(unscoped.length)throw Object.assign(new Error('Native catalog cannot be safely repaired: '+unscoped.join('; ')),{code:'CORRUPT'});
  for(const id of groups) {
    const name='ann_'+id,entry=tables.get(name);
    // The reserved native namespace may contain orphan shadows, but never silently destroy another module.
    if(entry&&!/^CREATE\s+VIRTUAL\s+TABLE\s+\S+\s+USING\s+vec1\s*\(/i.test(String(entry.sql)))
      throw Object.assign(new Error(`${name}: native namespace contains an unrecognized table`),{code:'CORRUPT'});
    if(damaged.has(id))continue;
    try {
      if(db.all(`PRAGMA integrity_check(${name})`).some(row=>Object.values(row)[0]!=='ok'))damaged.add(id);
    }catch(error){if((error as {code?:unknown})?.code==='SQLITE_CORRUPT_VTAB')damaged.add(id);else throw error;}
  }
  for(const id of damaged) {
    const name='ann_'+id;
    for(const suffix of ['insert','update','delete','trash'])db.sql.exec(`DROP TRIGGER IF EXISTS ${name}_${suffix}`);
    // vec1 xDestroy drops shadows without loading corrupt model/config payloads. A missing virtual table
    // can leave orphan shadows; the explicit rebuild owns this reserved namespace and removes only these.
    db.sql.exec(`DROP TABLE IF EXISTS ${name}`);
    for(const suffix of ['base','model','idx','meta','config'])db.sql.exec(`DROP TABLE IF EXISTS ${name}_${suffix}`);
    if(catalog)db.run('DELETE FROM vector_indexes WHERE id=?',[id]);
  }
}
