#!/bin/sh
# Renvara na ovom računalu: pokreće server i otvara preglednik.
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo "Renvara treba Node.js 20.11 ili noviji (https://nodejs.org ili paket vaše distribucije)."
  exit 1
fi
exec node program/start.mjs "$@"
