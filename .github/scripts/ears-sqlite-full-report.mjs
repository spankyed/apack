// Reject missing, skipped or substituted filesystem-full witnesses in the Linux platform artifact.
import assert from 'node:assert/strict';

export function verifyFilesystemFull(report,source){
  assert(report,'The real filesystem-full report is required');
  assert.equal(report.protocol,'ears-real-filesystem-full/2');assert.equal(report.source,source);
  assert.equal(report.completed,true);assert.equal(report.filesystem.type,0x01021994);
  assert.equal(report.filesystem.bytes,8*1024*1024);
  assert.deepEqual(report.cases.map(entry=>entry.mode),['commit','write','bulkLoad','unit']);
  for(const entry of report.cases){
    assert.equal(entry.completed,true);assert.equal(entry.error.code,'SQLITE_FULL');
    assert.equal(entry.enteredCommit,true);assert.equal(entry.availableBytesAtFailure,0);
    assert.equal(entry.synchronous,2);assert.equal(entry.walAutocheckpoint,1000);
    assert(entry.maxPageCount*4096>64*1024*1024,'A page quota must not impersonate filesystem exhaustion');
    assert(Number.isSafeInteger(entry.sequenceBefore)&&entry.sequenceBefore>=0);
    assert.equal(entry.sequenceAfterRefusal,entry.sequenceBefore);assert.equal(entry.sequenceAfterRecovery,entry.sequenceBefore+1);
    assert.deepEqual(entry.afterRefusalIds,['Row-before']);
    assert.deepEqual(entry.watchNotifications,[['Row-before'],['Row-before','Row-recovered']]);
    assert.equal(entry.refusedWriteInvisible,true);assert.equal(entry.reopenedReadOnly,true);
  }
  assert.equal(report.cases[0].fillerError,'ENOSPC');
}
