import { describe, expect, it } from 'vitest';
import { _openTestDatabase, _openTestRunHistory } from '../../src/testing/index.ts';

const expected=process.env.EARS_EVALUATION_BACKEND==='sqlite'?'sqlite/1':'elmdb/1';
describe('selected SDK test database backend',()=>{
  for(const [name,open] of [['app',_openTestDatabase],['history',_openTestRunHistory]] as const) {
    it(`opens ${name} on the selected real backend`,()=>{
      const {database}=open();
      try{expect(database.format).toBe(expected);expect(database.isOpen).toBe(true);}
      finally{database.close();}
    });
  }
});
