#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TASK_POST_RUN_TEST="$(mktemp -d "${TMPDIR:-/tmp}/mac2jb-post-run-state.XXXXXX")"
trap 'rm -rf "$TASK_POST_RUN_TEST"' EXIT
xcrun swiftc -parse-as-library -swift-version 5 -target arm64-apple-macos14.0 \
  -module-cache-path "$ROOT/.build-gui/module-cache" \
  "$ROOT/gui/PostRunSessionState.swift" "$ROOT/gui/WorkflowProgress.swift" \
  "$ROOT/scripts/test-post-run-state.swift" -o "$TASK_POST_RUN_TEST/tests"
"$TASK_POST_RUN_TEST/tests"
