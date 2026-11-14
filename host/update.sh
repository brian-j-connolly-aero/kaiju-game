#!/usr/bin/env bash
# Update Monster Battle 9001 to the newest copy and start it again (see docs/HOSTING.md).
exec "$(dirname "$0")/mb.sh" update "$@"
