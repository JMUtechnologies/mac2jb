#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TASK_OUNCECAKE_TEST="$(mktemp -d "${TMPDIR:-/tmp}/mac2jb-ouncecake-state.XXXXXX")"
trap 'rm -rf "$TASK_OUNCECAKE_TEST"' EXIT
xcrun swiftc -parse-as-library -swift-version 5 -target arm64-apple-macos14.0 \
  -module-cache-path "$ROOT/.build-gui/module-cache" \
  "$ROOT/gui/PostRunSessionState.swift" "$ROOT/gui/OunceCakeSession.swift" \
  "$ROOT/scripts/test-ouncecake-session.swift" -o "$TASK_OUNCECAKE_TEST/tests"
"$TASK_OUNCECAKE_TEST/tests"
