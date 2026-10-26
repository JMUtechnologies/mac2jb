#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TASK_RUN_MODE_TEST="$(mktemp -d "${TMPDIR:-/tmp}/mac2jb-run-mode.XXXXXX")"
trap 'rm -rf "$TASK_RUN_MODE_TEST"' EXIT
xcrun swiftc -parse-as-library -swift-version 5 -target arm64-apple-macos14.0 \
  -module-cache-path "$ROOT/.build-gui/module-cache" \
  "$ROOT/gui/SessionRunMode.swift" "$ROOT/gui/PostRunSessionState.swift" \
  "$ROOT/gui/WorkflowProgress.swift" "$ROOT/scripts/test-session-run-mode.swift" \
  -o "$TASK_RUN_MODE_TEST/tests"
"$TASK_RUN_MODE_TEST/tests"
