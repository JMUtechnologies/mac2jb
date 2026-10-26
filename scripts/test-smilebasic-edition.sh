#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TASK_EDITION_TEST="$(mktemp -d "${TMPDIR:-/tmp}/mac2jb-edition.XXXXXX")"
trap 'rm -rf "$TASK_EDITION_TEST"' EXIT
xcrun swiftc -parse-as-library -swift-version 5 -target arm64-apple-macos14.0 \
  -module-cache-path "$ROOT/.build-gui/module-cache" \
  "$ROOT/gui/SmileBASICEdition.swift" "$ROOT/scripts/test-smilebasic-edition.swift" \
  -o "$TASK_EDITION_TEST/tests"
"$TASK_EDITION_TEST/tests" "$ROOT/mac2jb-commands"
