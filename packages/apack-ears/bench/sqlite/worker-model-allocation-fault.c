// Disposable Linux/glibc allocator fault; never linked into the application.
#define _GNU_SOURCE
#include <dlfcn.h>
#include <errno.h>
#include <execinfo.h>
#include <fcntl.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/syscall.h>
#include <unistd.h>
#ifndef __GLIBC__
#error This disposable allocator probe requires Linux glibc.
#endif

// Calling glibc directly avoids recursive symbol resolution during preload startup.
extern void *__libc_malloc(size_t);
static _Thread_local int inspecting;
static int fired;

void *malloc(size_t size) {
  // The fixture uses 128 dimensions, 64 centroids and the 24-byte pinned BQ header.
  // SQLite adds allocator bookkeeping; never fail a differently sized allocation.
  const size_t model_bytes = 24 + 4 * 64 * 128;
  if (size < model_bytes || size > model_bytes + 64 || inspecting ||
      __sync_fetch_and_add(&fired, 0) || syscall(SYS_gettid) == (long)getpid())
    return __libc_malloc(size);
  int saved_errno = errno;
  inspecting = 1;
  const char *arm = getenv("EARS_WORKER_ALLOC_ARM");
  const char *event = getenv("EARS_WORKER_ALLOC_EVENT");
  const char *extension = getenv("EARS_WORKER_ALLOC_EXTENSION");
  const char *begin = getenv("EARS_WORKER_ALLOC_BEGIN");
  const char *end = getenv("EARS_WORKER_ALLOC_END");
  if (arm && event && extension && begin && end && !access(arm, F_OK)) {
    uintptr_t first = (uintptr_t)strtoull(begin, NULL, 16);
    uintptr_t last = (uintptr_t)strtoull(end, NULL, 16);
    void *frames[32];
    int count = backtrace(frames, 32);
    for (int i = 0; i < count && first < last; i++) {
      Dl_info info;
      if (!dladdr(frames[i], &info) || !info.dli_fname ||
          strcmp(info.dli_fname, extension)) continue;
      uintptr_t offset = (uintptr_t)frames[i] - (uintptr_t)info.dli_fbase;
      if (offset < first || offset >= last || !__sync_bool_compare_and_swap(&fired, 0, 1)) continue;
      int output = open(event, O_WRONLY | O_CREAT | O_EXCL, 0600);
      if (output < 0) _exit(91);
      char record[512];
      int length = snprintf(record, sizeof(record),
        "{\"allocator\":\"malloc\",\"mainThread\":false,\"extensionMatched\":true,"
        "\"functionMatched\":true,\"functionOffset\":%llu,\"functionBegin\":%llu,"
        "\"functionEnd\":%llu,\"requestedBytes\":%zu,\"modelBytes\":%zu,\"errno\":%d}\n",
        (unsigned long long)offset, (unsigned long long)first, (unsigned long long)last,
        size, model_bytes, ENOMEM);
      if (length < 0 || (size_t)length >= sizeof(record) ||
          write(output, record, (size_t)length) != length || syscall(SYS_fsync, output)) _exit(92);
      close(output);
      inspecting = 0;
      errno = ENOMEM;
      return NULL;
    }
  }
  inspecting = 0;
  errno = saved_errno;
  return __libc_malloc(size);
}
