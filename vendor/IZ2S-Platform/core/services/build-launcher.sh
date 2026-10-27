#!/usr/bin/env bash
set -euo pipefail
exec bash "$(dirname "$0")/../../shells/izlauncher/server/build.sh" "$@"
