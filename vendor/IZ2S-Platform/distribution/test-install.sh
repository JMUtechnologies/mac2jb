#!/bin/sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
TEMP=$(mktemp -d /tmp/iz2s-install-test-XXXXXX)
trap 'rm -rf -- "$TEMP"' EXIT HUP INT TERM
"$ROOT/install.sh" --prefix "$TEMP/installed" --no-system-packages --no-desktop
"$TEMP/installed/tools/node" "$TEMP/installed/sdk/check.cjs"
printf 'Isolated installation passed. Removed test installation: %s\n' "$TEMP"
