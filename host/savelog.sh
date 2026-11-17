#!/usr/bin/env bash
# Save everything Monster Battle 9001 and its tunnel wrote since they started into one dated
# text file in logs/ in the game folder (see docs/HOSTING.md).
exec "$(dirname "$0")/mb.sh" savelog "$@"
