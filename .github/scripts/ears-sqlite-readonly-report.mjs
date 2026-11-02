// Require real kernel, independent-reader and live-WAL witnesses; a readOnly option alone is insufficient.
import assert from 'node:assert/strict';

export function verifyFilesystemReadonly(report, source) {
  assert(report, 'The real read-only mount report is required');
  assert.equal(report.protocol, 'ears-real-filesystem-readonly/1');
  assert.equal(report.source, source); assert.equal(report.completed, true);
  for (const filesystem of [report.filesystem, report.reader.filesystem]) {
    assert(filesystem.options.split(',').includes('ro'));
    assert.equal(filesystem.kernelWriteError, 'EROFS');
  }
  assert.equal(report.reader.phase, 'pinned'); assert.equal(report.reader.count, 1);
  assert.equal(report.reader.applicationWriteError, 'READ_ONLY'); assert.equal(report.reader.driverWriteError, 'SQLITE_READONLY');
  assert.equal(report.writerCount, 17); assert(report.walBytesWhilePinned > 16 * 32768);
  assert.equal(report.blockedCheckpoint.busy, 1);
  assert(report.blockedCheckpoint.checkpointed < report.blockedCheckpoint.log);
  assert.equal(report.released.phase, 'released'); assert.equal(report.released.retainedCount, 1);
  assert.equal(report.released.currentCount, 17); assert.equal(report.readerExited, true);
  assert.equal(report.finalCheckpoint.busy, 0); assert.equal(report.walBytesAfterRelease, 0);
}
