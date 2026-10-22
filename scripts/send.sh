#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
[[ -f assets/bootstrap.bas ]] || { echo 'Bootstrap not bundled. Ask repository maintainer to commit snapshots.' >&2; exit 1; }
[[ -x ./mac2jb-send ]] || { echo 'Build first: make' >&2; exit 1; }
DYLD_LIBRARY_PATH="$PWD/vendor/libusbd" ./mac2jb-send assets/bootstrap.bas "$@"
