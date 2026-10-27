#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TASK_EDITION_TEST="$(mktemp -d "${TMPDIR:-/tmp}/mac2jb-edition.XXXXXX")"
trap 'rm -rf "$TASK_EDITION_TEST"' EXIT
xcrun swiftc -parse-as-library -swift-version 5 -target arm64-apple-macos14.0 \
  -module-cache-path "$ROOT/.build-gui/module-cache" \
  "$ROOT/gui/SmileBASICEdition.swift" "$ROOT/scripts/test-smilebasic-edition.swift" \
  -o "$TASK_EDITION_TEST/tests"
xcrun clang -std=c11 -D_POSIX_C_SOURCE=200809L -arch arm64 \
  -I"$ROOT/vendor/libusbd/include" "$ROOT/commands.c" \
  -L"$ROOT/vendor/libusbd" -lusbd -Wl,-rpath,"$ROOT/vendor/libusbd" \
  -framework CoreFoundation -framework IOKit -o "$TASK_EDITION_TEST/commands"
"$TASK_EDITION_TEST/tests" "$TASK_EDITION_TEST/commands"
