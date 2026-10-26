#!/bin/bash
set -euo pipefail
TASK_STREMIO_TEST_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TASK_STREMIO_TEST_DIR="$(mktemp -d "${TMPDIR:-/tmp}/mac2jb-account-fixtures.XXXXXX")"
trap 'rm -rf "$TASK_STREMIO_TEST_DIR"' EXIT
xcrun swiftc -parse-as-library -swift-version 5 -target arm64-apple-macos14.0 \
  -module-cache-path "$TASK_STREMIO_TEST_ROOT/.build-gui/module-cache" \
  "$TASK_STREMIO_TEST_ROOT/gui/StremioAccount.swift" \
  "$TASK_STREMIO_TEST_ROOT/scripts/test-stremio-account.swift" -o "$TASK_STREMIO_TEST_DIR/tests"
"$TASK_STREMIO_TEST_DIR/tests"
