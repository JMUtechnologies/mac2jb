#!/bin/sh
# Per-user Linux installation; never changes the system Node.js runtime.
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
CHECK=0
SYSTEM=1
DESKTOP=1
PREFIX=
while [ "$#" -gt 0 ]; do
  case "$1" in
    --check) CHECK=1;;
    --no-system-packages) SYSTEM=0;;
    --no-desktop) DESKTOP=0;;
    --prefix) shift; PREFIX=${1:?Missing installation folder};;
    --help) echo 'Usage: ./install.sh [--check] [--prefix PATH] [--no-system-packages] [--no-desktop]'; exit 0;;
    *) echo "Unknown option: $1" >&2; exit 2;;
  esac
  shift
done
case "$(uname -s):$(uname -m)" in
  Linux:x86_64) ARCH=x64;; Linux:aarch64|Linux:arm64) ARCH=arm64;;
  *) echo 'Only Linux x64 and ARM64 are supported.' >&2; exit 1;;
esac
missing() {
  for tool in python3 glslangValidator spirv-val git curl tar xz ssh ip ping; do
    command -v "$tool" >/dev/null 2>&1 || echo "$tool"
  done
  python3 -c 'from PIL import Image' >/dev/null 2>&1 || echo python-pillow
  [ -f /usr/share/fonts/truetype/dejavu/DejaVuSans.ttf ] || [ -f /usr/share/fonts/TTF/DejaVuSans.ttf ] || echo dejavu-fonts
}
NEEDED=$(missing)
NODE_OK=0
if command -v node >/dev/null 2>&1 && node -e 'process.exit(Number(process.versions.node.split(".")[0])>=22?0:1)'; then NODE_OK=1; fi
if [ "$CHECK" -eq 1 ]; then
  echo "Platform: linux-$ARCH"
  if [ -n "$NEEDED" ]; then printf 'Missing dependencies:\n%s\n' "$NEEDED"; else echo 'System dependencies: ready'; fi
  if [ "$NODE_OK" -eq 1 ]; then echo 'Node.js: ready'; else echo 'Node.js: installer will download a private Node.js 24 runtime'; fi
  [ -z "$NEEDED" ] && [ "$NODE_OK" -eq 1 ]; exit $?
fi
if [ -n "$NEEDED" ]; then
  if [ "$SYSTEM" -eq 0 ]; then printf 'Missing dependencies; no system changes requested:\n%s\n' "$NEEDED" >&2; exit 1; fi
  if [ "$(id -u)" -eq 0 ]; then SUDO=; else SUDO=sudo; fi
  echo 'Installing system dependencies. Your package manager may request a password.'
  if command -v apt-get >/dev/null 2>&1; then
    $SUDO apt-get update
    $SUDO apt-get install -y python3 python3-pil glslang-tools spirv-tools git curl ca-certificates tar xz-utils openssh-client fonts-dejavu-core xdg-utils iproute2 iputils-ping
  elif command -v pacman >/dev/null 2>&1; then
    # A full synchronized upgrade avoids unsupported partial upgrades on Arch.
    $SUDO pacman -Syu --needed python python-pillow glslang spirv-tools git curl ca-certificates tar xz openssh ttf-dejavu xdg-utils iproute2 iputils
  else echo 'Unsupported package manager. Install the listed dependencies manually.' >&2; exit 1; fi
fi
VERSION=$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["version"])' "$ROOT/package.json")
REV=$(python3 -c 'import json,sys;from pathlib import Path;p=Path(sys.argv[1])/"release.json";print(json.loads(p.read_text())["commit"][:8] if p.exists() else "source")' "$ROOT")
PREFIX=${PREFIX:-${XDG_DATA_HOME:-$HOME/.local/share}/iz2s-platform/releases/$VERSION-$REV}
case "$PREFIX" in /*) ;; *) echo '--prefix must be an absolute path' >&2; exit 1;; esac
if [ -e "$PREFIX" ]; then echo "Destination already exists: $PREFIX. Choose a new folder; existing installations are never overwritten." >&2; exit 1; fi
mkdir -p "$(dirname -- "$PREFIX")"
TEMP=$(mktemp -d "$(dirname -- "$PREFIX")/.iz2s-install-XXXXXX")
trap 'rm -rf -- "$TEMP"' EXIT HUP INT TERM
python3 - "$ROOT" "$TEMP" <<'PY'
import shutil,sys
from pathlib import Path
src,dst=map(Path,sys.argv[1:])
# No local configuration, keys, engine downloads, Git history or build output.
for p in src.iterdir():
 if p.name in {'.git','.dev','.release','.github','data','dist','node_modules'}:continue
 if p.is_symlink():raise SystemExit('Source symlink is not supported: '+p.name)
 if p.is_dir():shutil.copytree(p,dst/p.name,ignore=shutil.ignore_patterns('__pycache__','*.pyc','.engine-install.json','.git','node_modules'))
 else:shutil.copy2(p,dst/p.name)
PY
if [ "$NODE_OK" -eq 0 ]; then
  BASE=https://nodejs.org/dist/latest-v24.x
  curl --fail --location --proto '=https' --tlsv1.2 "$BASE/SHASUMS256.txt" -o "$TEMP/node-shasums.txt"
  FILE=$(awk -v arch="$ARCH" '$2 ~ ("^node-v24\\.[0-9]+\\.[0-9]+-linux-" arch "\\.tar\\.xz$") {print $2}' "$TEMP/node-shasums.txt")
  [ "$(printf '%s\n' "$FILE" | wc -l)" -eq 1 ] && [ -n "$FILE" ] || { echo 'Cannot resolve the official Node.js archive' >&2; exit 1; }
  curl --fail --location --proto '=https' --tlsv1.2 "$BASE/$FILE" -o "$TEMP/$FILE"
  (cd "$TEMP"; awk -v file="$FILE" '$2==file' node-shasums.txt | sha256sum -c -)
  mkdir -p "$TEMP/data/runtime/node"
  tar -xJf "$TEMP/$FILE" --strip-components=1 -C "$TEMP/data/runtime/node"
  rm -- "$TEMP/$FILE" "$TEMP/node-shasums.txt"
fi
"$TEMP/tools/node" "$TEMP/sdk/pack.cjs"
"$TEMP/tools/node" "$TEMP/sdk/pack-agent.cjs"
"$TEMP/tools/node" "$TEMP/sdk/check.cjs"
"$TEMP/tools/node" "$TEMP/hardware/dependencies.cjs"
mv -- "$TEMP" "$PREFIX"
trap - EXIT HUP INT TERM
if [ "$DESKTOP" -eq 1 ]; then "$PREFIX/tools/node" "$PREFIX/desktop/install.cjs"; fi
printf '\nInstalled in %s\nLaunch: %s/start.sh\nPreview: %s/preview.sh\n' "$PREFIX" "$PREFIX" "$PREFIX"
echo 'ARM input is installed separately from First-time setup. Nothing was sent to the console.'
