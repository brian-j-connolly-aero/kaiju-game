#!/usr/bin/env bash
# Show the latest messages from Monster Battle 9001 (see docs/HOSTING.md).
exec "$(dirname "$0")/mb.sh" logs "$@"
