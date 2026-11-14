#!/usr/bin/env bash
# Stop Monster Battle 9001 (see docs/HOSTING.md).
exec "$(dirname "$0")/mb.sh" stop "$@"
