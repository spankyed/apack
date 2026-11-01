#define _GNU_SOURCE
#include <unistd.h>
#include <sys/syscall.h>
#include <sys/types.h>
#include <fcntl.h>
#include <errno.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
static int fired;
static int synced(int fd, int data) {
  int result = (int)syscall(data ? SYS_fdatasync : SYS_fsync, fd);
  if (result || getenv("EARS_LOST_ACK_DISABLED")) return result;
  const char *target=getenv("EARS_LOST_ACK_WAL"), *arm=getenv("EARS_LOST_ACK_ARM"), *event=getenv("EARS_LOST_ACK_EVENT");
  if (!target || !arm || !event || access(arm,F_OK)) return result;
  char descriptor[64], actual[4096];
  snprintf(descriptor,sizeof(descriptor),"/proc/self/fd/%d",fd);
  ssize_t count=readlink(descriptor,actual,sizeof(actual)-1);
  if (count<0) return result;
  actual[count]=0;
  if (strcmp(actual,target) || !__sync_bool_compare_and_swap(&fired,0,1)) return result;
  int out=open(event,O_WRONLY|O_CREAT|O_EXCL,0600);
  if (out<0) _exit(91);
  int return_error=getenv("EARS_LOST_ACK_RETURN_EIO")!=NULL;
  char record[4608];
  int length=snprintf(record,sizeof(record),"{\"syscall\":\"%s\",\"result\":%d,\"pid\":%ld,\"file\":\"%s\",\"point\":\"%s\"}\n",data?"fdatasync":"fsync",result,(long)getpid(),actual,return_error?"after-success-return-eio":"after-success-before-return");
  if (write(out,record,(size_t)length)!=length || syscall(SYS_fsync,out)) _exit(92);
  close(out);
  if (return_error) { errno=EIO; return -1; }
  // The parent must observe stopped state and issue SIGKILL; no SQLite cleanup or acknowledgement can run.
  syscall(SYS_kill,getpid(),SIGSTOP);
  _exit(93);
}
int fsync(int fd) { return synced(fd,0); }
int fdatasync(int fd) { return synced(fd,1); }
