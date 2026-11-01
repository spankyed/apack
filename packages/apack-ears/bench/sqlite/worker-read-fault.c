// Interpose the exported libc ABI, not glibc's fortified inline pread wrappers.
// This affects only this disposable test translation unit.
#undef _FORTIFY_SOURCE
#define _FORTIFY_SOURCE 0
#define _GNU_SOURCE
#include <unistd.h>
#include <sys/syscall.h>
#include <sys/types.h>
#include <fcntl.h>
#include <errno.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
// Test-only Linux preload. Match one owned database descriptor, exclude the foreground thread,
// and retain a syscall witness before returning an actual EIO to SQLite's native read path.
static int fired;
static unsigned long successful_reads;
static ssize_t read_at(int fd, void *buffer, size_t size, off64_t offset) {
  const char *target=getenv("EARS_WORKER_READ_FILE"), *arm=getenv("EARS_WORKER_READ_ARM"), *event=getenv("EARS_WORKER_READ_EVENT");
  if (target && arm && event && syscall(SYS_gettid)!=(long)getpid() && !access(arm,F_OK)) {
    char descriptor[64], actual[4096];
    snprintf(descriptor,sizeof(descriptor),"/proc/self/fd/%d",fd);
    ssize_t count=readlink(descriptor,actual,sizeof(actual)-1);
    if (count>=0) {
      actual[count]=0;
      if (!strcmp(actual,target)) {
        const char *selected=getenv("EARS_WORKER_READ_OFFSET");
        off64_t target_offset=selected ? (off64_t)strtoll(selected,NULL,10) : 0;
        if (offset<=target_offset && target_offset-offset<(off64_t)size && __sync_bool_compare_and_swap(&fired,0,1)) {
          int out=open(event,O_WRONLY|O_CREAT|O_EXCL,0600);
          if (out<0) _exit(91);
          char record[512];
          int length=snprintf(record,sizeof(record),"{\"syscall\":\"pread\",\"targetMatched\":true,\"mainThread\":false,\"offset\":%lld,\"requestedBytes\":%zu,\"errno\":%d,\"targetOffset\":%lld,\"successfulMatchedReads\":%lu}\n",(long long)offset,size,EIO,(long long)target_offset,__sync_fetch_and_add(&successful_reads,0));
          if (write(out,record,(size_t)length)!=length || syscall(SYS_fsync,out)) _exit(92);
          close(out); errno=EIO; return -1;
        }
        ssize_t result=syscall(SYS_pread64,fd,buffer,size,offset);
        if (result>=0) __sync_fetch_and_add(&successful_reads,1);
        return result;
      }
    }
  }
  return syscall(SYS_pread64,fd,buffer,size,offset);
}
ssize_t pread(int fd, void *buffer, size_t size, off_t offset) { return read_at(fd,buffer,size,offset); }
ssize_t pread64(int fd, void *buffer, size_t size, off64_t offset) { return read_at(fd,buffer,size,offset); }
