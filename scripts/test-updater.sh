#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TASK_UPDATER_BUILD="$(mktemp -d "${TMPDIR:-/tmp}/mac2jb-updater-tests.XXXXXX")"
trap 'rm -rf "$TASK_UPDATER_BUILD"' EXIT
xcrun clang -target arm64-apple-macos14.0 "$ROOT/scripts/updater-test-fixture.c" -o "$TASK_UPDATER_BUILD/fixture"
xcrun swiftc -swift-version 5 -target arm64-apple-macos14.0 -module-cache-path "$ROOT/.build-gui/module-cache" \
  -framework AppKit -framework CryptoKit "$ROOT/gui/BuildIdentity.swift" "$ROOT/gui/UpdatePackage.swift" \
  "$ROOT/gui/UpdateInstaller.swift" "$ROOT/gui/AppUpdater.swift" \
  "$ROOT/scripts/test-updater.swift" -o "$TASK_UPDATER_BUILD/tests"
"$TASK_UPDATER_BUILD/tests" "$TASK_UPDATER_BUILD/fixture"
