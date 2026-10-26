#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TASK_HOMEBREW_TEST="$(mktemp -d "${TMPDIR:-/tmp}/mac2jb-homebrew-state.XXXXXX")"
trap 'rm -rf "$TASK_HOMEBREW_TEST"' EXIT
xcrun swiftc -parse-as-library -swift-version 5 -target arm64-apple-macos14.0 \
  -module-cache-path "$ROOT/.build-gui/module-cache" \
  "$ROOT/gui/PostRunSessionState.swift" "$ROOT/scripts/test-homebrew-state.swift" \
  -o "$TASK_HOMEBREW_TEST/tests"
"$TASK_HOMEBREW_TEST/tests"
