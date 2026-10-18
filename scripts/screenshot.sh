#!/bin/sh
# Скриншот страницы через headless Chrome (для визуальной проверки UI агентом).
# Использование: scripts/screenshot.sh <url|file> <out.png> [light|dark] [ширина] [высота]
# Тема dark включает prefers-color-scheme: dark (как тёмный режим системы).
set -eu
URL="$1"; OUT="$2"; THEME="${3:-light}"; W="${4:-500}"; H="${5:-900}"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
# Chrome не работает в песочнице Claude Code (Mach-порты): агент запускает скрипт
# вне песочницы (нужно sandbox.allowUnsandboxedCommands: true). Профиль — временный.
export TMPDIR="${TMPDIR:-/tmp}/chrome"
export MAC_CHROMIUM_TMPDIR="$TMPDIR" # Chrome на macOS берёт временную папку отсюда, а не из TMPDIR
mkdir -p "$TMPDIR"
PROFILE="$(mktemp -d "$TMPDIR/p.XXXXXX")"
trap 'rm -r "$PROFILE"' EXIT
case "$URL" in http*|file:*) ;; *) URL="file://$(cd "$(dirname "$URL")" && pwd)/$(basename "$URL")";; esac
# Тему задаём явно в обе стороны, иначе Chrome берёт тему системы
DARK="--blink-settings=preferredColorScheme=1"
[ "$THEME" = dark ] && DARK="--force-dark-mode --blink-settings=preferredColorScheme=0"
# shellcheck disable=SC2086
"$CHROME" --headless=new --disable-gpu --hide-scrollbars --no-first-run --disable-crash-reporter \
  --user-data-dir="$PROFILE" --window-size="$W,$H" $DARK \
  --virtual-time-budget=5000 --screenshot="$OUT" "$URL" 2>"$PROFILE/chrome.log" \
  || { tail -5 "$PROFILE/chrome.log" >&2; exit 1; }
echo "$OUT"
