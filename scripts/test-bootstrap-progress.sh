#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TASK_BOOTSTRAP_TEST="$(mktemp -d "${TMPDIR:-/tmp}/mac2jb-bootstrap-progress.XXXXXX")"
trap 'rm -rf "$TASK_BOOTSTRAP_TEST"' EXIT
xcrun swiftc -parse-as-library -swift-version 5 -target arm64-apple-macos14.0 \
  -module-cache-path "$ROOT/.build-gui/module-cache" \
  "$ROOT/gui/BootstrapLineProgress.swift" "$ROOT/scripts/test-bootstrap-progress.swift" \
  -o "$TASK_BOOTSTRAP_TEST/tests"
"$TASK_BOOTSTRAP_TEST/tests"
