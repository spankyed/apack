#define _GNU_SOURCE
#include <dlfcn.h>
#include <errno.h>
#include <fcntl.h>
#include <limits.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

typedef int (*sync_fn)(int);
static int sync_with_fault(int fd, sync_fn next, const char *operation) {
  const char *target = getenv("EARS_FAULT_WAL"), *marker = getenv("EARS_FAULT_MARKER"), *log = getenv("EARS_FAULT_LOG");
  char link[64], actual[PATH_MAX], mode[16] = {0};
  if (!target || !marker || !log) return next(fd);
  snprintf(link, sizeof(link), "/proc/self/fd/%d", fd);
  ssize_t size = readlink(link, actual, sizeof(actual) - 1);
  if (size < 0) return next(fd);
  actual[size] = 0;
  if (strcmp(actual, target)) return next(fd);
  int control = open(marker, O_RDONLY);
  if (control < 0) return next(fd);
  ssize_t read_count = read(control, mode, sizeof(mode) - 1);
  close(control);
  if (read_count <= 0 || unlink(marker)) return next(fd);
  int result = -999, original_errno = 0;
  if (!strcmp(mode, "after")) { result = next(fd); original_errno = errno; }
  int report = open(log, O_WRONLY | O_CREAT | O_APPEND, 0600);
  if (report >= 0) {
    dprintf(report, "{\"operation\":\"%s\",\"mode\":\"%s\",\"originalResult\":%d,\"originalErrno\":%d,\"returnedErrno\":%d}\n", operation, mode, result, original_errno, EIO);
    close(report);
  }
  errno = EIO; return -1;
}
int fsync(int fd) {
  static sync_fn next;
  if (!next) next = (sync_fn)dlsym(RTLD_NEXT, "fsync");
  return sync_with_fault(fd, next, "fsync");
}
int fdatasync(int fd) {
  static sync_fn next;
  if (!next) next = (sync_fn)dlsym(RTLD_NEXT, "fdatasync");
  return sync_with_fault(fd, next, "fdatasync");
}
