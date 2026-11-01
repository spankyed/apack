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
static ssize_t read_at(int fd, void *buffer, size_t size, off64_t offset) {
  const char *target=getenv("EARS_WORKER_READ_FILE"), *arm=getenv("EARS_WORKER_READ_ARM"), *event=getenv("EARS_WORKER_READ_EVENT");
  if (target && arm && event && syscall(SYS_gettid)!=(long)getpid() && !access(arm,F_OK)) {
    char descriptor[64], actual[4096];
    snprintf(descriptor,sizeof(descriptor),"/proc/self/fd/%d",fd);
    ssize_t count=readlink(descriptor,actual,sizeof(actual)-1);
    if (count>=0) {
      actual[count]=0;
      if (!strcmp(actual,target) && __sync_bool_compare_and_swap(&fired,0,1)) {
        int out=open(event,O_WRONLY|O_CREAT|O_EXCL,0600);
        if (out<0) _exit(91);
        char record[256];
        int length=snprintf(record,sizeof(record),"{\"syscall\":\"pread\",\"targetMatched\":true,\"mainThread\":false,\"offset\":%lld,\"requestedBytes\":%zu,\"errno\":%d}\n",(long long)offset,size,EIO);
        if (write(out,record,(size_t)length)!=length || syscall(SYS_fsync,out)) _exit(92);
        close(out); errno=EIO; return -1;
      }
    }
  }
  return syscall(SYS_pread64,fd,buffer,size,offset);
}
ssize_t pread(int fd, void *buffer, size_t size, off_t offset) { return read_at(fd,buffer,size,offset); }
ssize_t pread64(int fd, void *buffer, size_t size, off64_t offset) { return read_at(fd,buffer,size,offset); }
