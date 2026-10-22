#!/bin/sh
set -eu
cd "$(dirname "$0")"
if [ ! -d vendor/libusbd/.git ]; then
  mkdir -p vendor
  git clone https://github.com/shinyquagsire23/libusbd.git vendor/libusbd
fi
make
printf '\nBuilt sender. Next: ./usb-text-sender bootstrap.bas --dry-run\n'
