#!/bin/bash
# ============================================================
# tools/snap.sh — 用 headless Edge 渲染 tools/_out 下的页面并截图
# 用法: bash tools/snap.sh <id> [id...]
#   id 取值: 某套风格（如 s-pop）、audit、act
# Edge 是 GUI 程序会立刻脱离进程，PNG 异步落盘，必须轮询等待
# ============================================================
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="$HERE/_out"
EDGE="/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"

for id in "$@"; do
  page="$OUT/$id.html"
  png="$OUT/$id.png"
  [ -f "$page" ] || { echo "FAIL $id (缺 $page)"; continue; }
  # 报告页要看得全，用宽窗口 + 1 倍；风格页按手机比例 2 倍
  case "$id" in
    audit|act) size="1100,760"; scale=1 ;;
    *)         size="440,900";  scale=2 ;;
  esac
  rm -f "$png"
  # Git Bash 的路径是 /c/Users/...，Edge 只认 C:/Users/... 的 file:// URL
  url="file:///$(cygpath -m "$page")"
  "$EDGE" --headless=new --no-sandbox --disable-gpu --hide-scrollbars \
    --user-data-dir="${TMPDIR:-/tmp}/edgedbg-$id" \
    --force-device-scale-factor=$scale --window-size=$size \
    --virtual-time-budget=9000 --screenshot="$png" \
    "$url" > /dev/null 2>&1
  for i in $(seq 1 30); do
    [ -f "$png" ] && break
    sleep 1
  done
  sleep 1
  if [ -f "$png" ]; then
    echo "ok   $png ($(stat -c%s "$png") bytes)"
  else
    echo "FAIL $id"
  fi
done
