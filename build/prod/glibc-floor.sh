#!/usr/bin/env bash
# Whether every binary a packaged Linux app ships loads at its glibc floor: `glibc-floor.sh <unpacked app> <floor>`.
# Run by .github/workflows/build-linux.yml with the floor the deb declares (`libc6 (>= …)`, electron-builder.mjs).
#
# Each ELF file's newest glibc symbol version is read from its dynamic symbols. It fails:
#   - on a file needing a glibc past the floor, which wouldn't load on a system at the floor;
#   - on a file that links libc.so.6 and names no glibc version, or whose headers can't be read, rather than pass it;
#   - when the newest any file needs isn't the floor itself, since the floor the deb and the docs state is that need;
#   - when it reads no ELF file at all.
# Files that don't link libc.so.6 (static, or Go's or musl's) need no glibc, and are listed as such.
set -euo pipefail

dir=${1:?usage: glibc-floor.sh <unpacked app> <floor>}
floor=${2:?usage: glibc-floor.sh <unpacked app> <floor>}

newer() { [ "$1" != "$2" ] && [ "$(printf '%s\n%s\n' "$1" "$2" | sort -V | tail -1)" = "$1" ]; }

count=0
newest_all=""
over=()
unread=()
static=()
while IFS= read -r -d '' file; do
  [ "$(head -c 4 "$file" | od -An -c | tr -d ' ')" = '177ELF' ] || continue
  count=$((count + 1))
  name=${file#"$dir"/}
  newest=$( (nm -D --undefined-only "$file" 2> /dev/null || true) | grep -o '@GLIBC_[0-9.]*' | sed 's/@GLIBC_//' | sort -uV | tail -1 || true)
  if [ -z "$newest" ]; then
    # objdump failing is a file this couldn't read, not one that needs no glibc
    if ! headers=$(objdump -p "$file" 2> /dev/null); then unread+=("$name")
    elif grep -qE 'NEEDED +libc\.so\.6' <<< "$headers"; then unread+=("$name")
    else static+=("$name"); fi
    continue
  fi
  echo "$newest $name"
  if [ -z "$newest_all" ] || newer "$newest" "$newest_all"; then newest_all=$newest; fi
  if newer "$newest" "$floor"; then over+=("$newest $name"); fi
done < <(find "$dir" -type f -print0)

for name in "${static[@]+"${static[@]}"}"; do echo "no glibc: $name"; done
echo "read $count ELF files; the app needs glibc ${newest_all:-none}, and the floor is $floor"
status=0
if [ "$count" -eq 0 ] || [ -z "$newest_all" ]; then
  echo "::error::No ELF file in $dir named a glibc version, so none was read"
  status=1
fi
for entry in "${unread[@]+"${unread[@]}"}"; do
  echo "::error::$entry links libc.so.6 and names no glibc version, or couldn't be read: its glibc need is unknown"
  status=1
done
for entry in "${over[@]+"${over[@]}"}"; do
  echo "::error::Past the glibc floor $floor: $entry"
  status=1
done
if [ -n "$newest_all" ] && [ "$newest_all" != "$floor" ] && [ "${#over[@]}" -eq 0 ]; then
  echo "::error::The app needs glibc $newest_all and the floor is $floor: make the floor $newest_all (electron-builder.mjs) and the docs with it"
  status=1
fi
exit "$status"
