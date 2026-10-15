#!/bin/bash
# Renvara na ovom računalu: pokreće server i otvara preglednik.
cd "$(dirname "$0")" || exit 1
export PATH="$PATH:/usr/local/bin:/opt/homebrew/bin"
if ! command -v node >/dev/null 2>&1; then
  echo
  echo "  Renvara treba Node.js. Instalirajte verziju LTS s https://nodejs.org"
  echo "  (otvaram stranicu), zatim ponovno pokrenite ovu datoteku."
  echo
  open "https://nodejs.org/"
  read -r -p "  Pritisnite Enter za zatvaranje…" _
  exit 1
fi
exec node program/start.mjs "$@"
