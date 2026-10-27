#!/bin/sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
exec "$ROOT/tools/node" "$ROOT/distribution/preview.cjs" "$@"
