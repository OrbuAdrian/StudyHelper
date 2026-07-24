#!/usr/bin/env sh
set -eu
PORT="${1:-8080}"
cd "$(dirname "$0")"
printf 'Study Forge is available at http://localhost:%s\n' "$PORT"
python3 -m http.server "$PORT"
