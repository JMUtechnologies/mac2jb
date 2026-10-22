#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
[[ -f vendor/ns2jb/run.cjs ]] || { echo 'ns2jb host is not bundled.' >&2; exit 1; }
cd vendor/ns2jb
exec node run.cjs "$@"
