#!/bin/zsh
cd -- "${0:A:h}" || exit 1
# Finder may start with a minimal PATH. Include common Node installation paths.
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
if ! command -v node >/dev/null 2>&1; then
  print 'Install Node.js 22 or newer from https://nodejs.org then reopen this file.'
  read -r '?Press Enter to close...'
  exit 1
fi
node ./scripts/launch.mjs "$@"
result=$?
if (( result != 0 )); then
  read -r '?Press Enter to close...'
fi
exit "$result"
