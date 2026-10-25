#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RECOVERY_BUILD="$(mktemp -d "${TMPDIR:-/tmp}/mac2jb-recovery-tests.XXXXXX")"
trap 'rm -rf "$RECOVERY_BUILD"' EXIT
xcrun swiftc -swift-version 5 -target arm64-apple-macos14.0 \
  -module-cache-path "$ROOT/.build-gui/module-cache" \
  "$ROOT/gui/SessionRecovery.swift" "$ROOT/scripts/test-session-recovery.swift" \
  -o "$RECOVERY_BUILD/session-recovery-tests"
"$RECOVERY_BUILD/session-recovery-tests"
