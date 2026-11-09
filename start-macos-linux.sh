#!/usr/bin/env sh
# Start Claude Code Office (needs Node.js 18+ from https://nodejs.org).
# macOS: rename to .command to launch it with a double-click from Finder.
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 18 or newer is required: https://nodejs.org"
  exit 1
fi
exec node server.js --open "$@"
