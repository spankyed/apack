// Candidate qualification selects the same real backend for SDK app and run-history fixtures.
// This test-only switch never selects production storage or migrates an existing profile.
import { createTemporaryDatabases as elmdbDatabases } from '@apackdev/ears/lmdb';
import { createTemporaryDatabases as sqliteDatabases } from '@apackdev/ears/sqlite';

export function createTestDatabases(): ReturnType<typeof sqliteDatabases> {
  const backend=process.env.EARS_EVALUATION_BACKEND??'elmdb';
  if(backend==='sqlite')return sqliteDatabases();
  if(backend==='elmdb')return elmdbDatabases();
  throw new Error(`Unknown EARS test backend: ${backend}`);
}
