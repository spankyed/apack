import { constants } from 'node:fs'
import { open, lstat, unlink } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import type { ClaudeTerminalImageFileFormat } from './terminal-image-file.ts'

// Pinned Darwin arm64 stat64 ABI (sys/stat.h): st_size at96. POSIX allocation is page-rounded.
const darwinReader = String.raw`ObjC.import('Foundation');
ObjC.bindFunction('shm_open',['int',['char *','int']]);
ObjC.bindFunction('shm_unlink',['int',['char *']]);
ObjC.bindFunction('fstat',['int',['int','void *']]);
ObjC.bindFunction('mmap',['void *',['void *','unsigned long','int','int','int','long long']]);
ObjC.bindFunction('mprotect',['int',['void *','unsigned long','int']]);
ObjC.bindFunction('munmap',['int',['void *','unsigned long']]);
ObjC.bindFunction('close',['int',['int']]);
function sizeOf(base64){var alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/',bits=0,value=0,bytes=[];for(var i=0;i<base64.length;i++){var digit=alphabet.indexOf(base64[i]);if(digit<0)break;value=(value<<6)|digit;bits+=6;if(bits>=8){bits-=8;bytes.push((value>>bits)&255);}}var size=0;for(var j=0;j<8;j++)size+=bytes[j]*Math.pow(256,j);return size;}
function run(argv){
 var name=argv[0],length=Number(argv[1]),fd=-1,mapping,pixels;
 if(!/^\/[A-Za-z0-9._-]{1,29}$/.test(name)||length<1||length>67108864||Math.floor(length)!==length)throw Error('Invalid shared image');
 try{
  fd=$.shm_open(name,0);if(fd<0)throw Error('Shared image open failed');
  var stat=$.NSMutableData.dataWithLength(256);if($.fstat(fd,stat.mutableBytes)!==0)throw Error('Shared image stat failed');
  var size=sizeOf(ObjC.unwrap(stat.subdataWithRange({location:96,length:8}).base64EncodedStringWithOptions(0)));
  if(!isFinite(size)||size<length||size>9007199254740991)throw Error('Shared image is too short');
  mapping=$.mmap(null,length,1,1,fd,0);if($.mprotect(mapping,length,1)!==0)throw Error('Shared image map failed');
  pixels=$.NSData.dataWithBytesLength(mapping,length);
 }finally{if(mapping)$.munmap(mapping,length);if(fd>=0)$.close(fd);}
 if($.shm_unlink(name)!==0)throw Error('Shared image unlink failed');
 return ObjC.unwrap(pixels.base64EncodedStringWithOptions(0));
}`

/** Consume one local POSIX raw image; the Claude engine and browser never open its name. */
export async function readClaudeTerminalSharedImage(name: string, image: ClaudeTerminalImageFileFormat, signal?: AbortSignal): Promise<Buffer> {
  signal?.throwIfAborted()
  if (!/^\/[A-Za-z0-9._-]{1,254}$/.test(name) || image.format === 'png') throw new Error('Invalid shared image name or format')
  if (!Number.isSafeInteger(image.width) || image.width < 1 || image.width > 4096 || !Number.isSafeInteger(image.height) || image.height < 1 || image.height > 4096) throw new Error('Invalid shared image dimensions')
  const length = image.width * image.height * (image.format === 'rgb' ? 3 : 4)
  if (process.platform === 'darwin') {
    if (process.arch !== 'arm64' || name.length > 30) throw new Error('Unsupported Darwin shared image boundary')
    const encoded = await new Promise<Buffer>((resolve, reject) => {
      execFile('/usr/bin/osascript', ['-l', 'JavaScript', '-e', darwinReader, name, String(length)], { encoding: 'buffer', timeout: 3500, maxBuffer: Math.ceil(length / 3) * 4 + 64, killSignal: 'SIGKILL', signal }, (error, stdout) => { if (error) reject(error); else resolve(stdout) })
    })
    signal?.throwIfAborted()
    const text = encoded.toString('ascii').trim(), pixels = Buffer.from(text, 'base64')
    if (pixels.length !== length || pixels.toString('base64') !== text) throw new Error('Invalid shared image delivery')
    return pixels
  }
  if (process.platform !== 'linux') throw new Error('POSIX shared images are unavailable on this platform')
  const path = '/dev/shm/' + name.slice(1), file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  let pixels: Buffer
  try {
    const before = await file.stat()
    if (!before.isFile() || before.size < length) throw new Error('Shared image is too short or not regular')
    pixels = Buffer.alloc(length)
    let offset = 0
    while (offset < length) {
      signal?.throwIfAborted()
      const { bytesRead } = await file.read(pixels, offset, length - offset, offset)
      if (!bytesRead) throw new Error('Shared image changed while reading')
      offset += bytesRead
    }
    signal?.throwIfAborted()
    const current = await lstat(path)
    if (!current.isFile() || current.ino !== before.ino || current.dev !== before.dev || current.size < length) throw new Error('Shared image object was replaced')
    signal?.throwIfAborted()
    await unlink(path)
    return pixels
  } finally { await file.close() }
}
