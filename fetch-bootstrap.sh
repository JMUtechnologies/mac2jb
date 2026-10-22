#!/bin/sh
set -eu
cd "$(dirname "$0")"
# Download at use time to preserve upstream attribution and avoid a stale bundled copy.
curl --fail --location --show-error --silent \
  'https://gitlab.com/pepsipu/ns2jb/-/raw/main/bootstrap.bas' \
  -o bootstrap.bas
printf 'Downloaded upstream bootstrap.bas; review its contents and license before running.\n'
shasum -a 256 bootstrap.bas
