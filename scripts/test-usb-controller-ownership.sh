#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OWNERSHIP_BUILD="$(mktemp -d "${TMPDIR:-/tmp}/mac2jb-iokit-ownership.XXXXXX")"
trap 'rm -rf "$OWNERSHIP_BUILD"' EXIT
SOURCE="$ROOT/scripts/test-usb-controller-ownership.c"
INCLUDE="$ROOT/vendor/libusbd/src/plat/macos"
compiler=(xcrun clang -std=c11 -D_DARWIN_C_SOURCE -target arm64-apple-macos14.0
  -I"$INCLUDE" "$SOURCE" -framework CoreFoundation -framework IOKit)
"${compiler[@]}" -DMAC2JB_TEST_OMIT_CONTROLLER_RETAIN=1 -o "$OWNERSHIP_BUILD/missing-retain"
"${compiler[@]}" -o "$OWNERSHIP_BUILD/patched"
# The negative control must fail at the missing-reference assertion, without
# proceeding to the invalid second release that caused the original crash.
if "$OWNERSHIP_BUILD/missing-retain" >"$OWNERSHIP_BUILD/baseline.log" 2>&1; then
  echo 'Missing-retain negative control unexpectedly passed.' >&2; exit 1
fi
case "$(cat "$OWNERSHIP_BUILD/baseline.log")" in
  *'FAIL: wrapper did not acquire an independent IOKit reference'*)
    echo 'PASS missing-retain baseline detected safely before an invalid release' ;;
  *) cat "$OWNERSHIP_BUILD/baseline.log" >&2; exit 1 ;;
esac
"$OWNERSHIP_BUILD/patched"
