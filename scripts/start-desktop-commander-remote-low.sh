#!/usr/bin/env bash
set -Eeuo pipefail

# Desktop Commander 0.2.x intentionally defaults each Node process to a
# 16-thread libuv pool. On this shared CloudLinux account that consumes most of
# the per-user PID/thread budget before Passenger starts Talk2Me. Keep the
# remote terminal lightweight so the CRM retains enough headroom for web work.
export UV_THREADPOOL_SIZE="${UV_THREADPOOL_SIZE:-2}"
export NODE_OPTIONS="${NODE_OPTIONS:---v8-pool-size=1}"

NODE="${DESKTOP_COMMANDER_NODE:-/opt/alt/alt-nodejs22/root/usr/bin/node}"
CACHE_ROOT="${DESKTOP_COMMANDER_CACHE_ROOT:-/home/uent/.npm/_npx}"

[ -x "$NODE" ] || { echo "Desktop Commander Node runtime unavailable: $NODE" >&2; exit 1; }

ENTRY="$(
  find "$CACHE_ROOT" -path '*/node_modules/.bin/desktop-commander' -type f -printf '%T@ %p\n' 2>/dev/null \
    | sort -nr \
    | head -n 1 \
    | cut -d' ' -f2-
)"

if [ -z "$ENTRY" ] || [ ! -f "$ENTRY" ]; then
  echo "Desktop Commander cache is not available under $CACHE_ROOT." >&2
  echo "Prime the package cache once, then use this lightweight launcher for normal remote access." >&2
  exit 1
fi

echo "DESKTOP_COMMANDER_REMOTE_MODE=LOW_RESOURCE"
echo "UV_THREADPOOL_SIZE=$UV_THREADPOOL_SIZE"
echo "NODE_OPTIONS=$NODE_OPTIONS"
exec "$NODE" "$ENTRY" remote
