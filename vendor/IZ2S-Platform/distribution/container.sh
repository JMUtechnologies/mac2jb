#!/bin/sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
if command -v podman >/dev/null 2>&1; then ENGINE=podman; elif command -v docker >/dev/null 2>&1; then ENGINE=docker; else echo 'Install rootless Podman or Docker first.' >&2; exit 1; fi
"$ENGINE" info >/dev/null 2>&1 || { echo "$ENGINE is installed but not ready. See distribution/README-development.md." >&2; exit 1; }
# No host files, devices, SSH agent, host network or privileged mode.
"$ENGINE" build -f "$ROOT/distribution/Containerfile" -t iz2s-release-preview "$ROOT"
PORT=${IZ2S_PREVIEW_PORT:-39518}
case "$PORT" in *[!0-9]*|'') echo "Invalid preview port" >&2; exit 2;; esac
echo "Use host port $PORT in the launch URL printed below."
exec "$ENGINE" run --rm --init --read-only --cap-drop=ALL --security-opt=no-new-privileges --tmpfs /tmp:rw,noexec,nosuid,size=256m --tmpfs /opt/iz2s/data:rw,noexec,nosuid,uid=10001,gid=10001,size=128m -e IZ2S_PREVIEW_PORT="$PORT" -p "127.0.0.1:$PORT:39517" iz2s-release-preview
