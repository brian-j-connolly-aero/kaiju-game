#!/usr/bin/env bash
# Regenerates every sound effect: synthesis (numpy and scipy), mastering, .ogg and .mp3 encoding
# with ffmpeg, the partial manifest, measurements, spectrogram sheets and docs/audio/SFX.md.
#
#   tools/audio/sfx/build.sh                 everything
#   tools/audio/sfx/build.sh 'kaiju_roar*'   only the sounds that match (measurements for those)
#   tools/audio/sfx/build.sh --no-verify     skip measurements, pictures and docs
#
# Intermediate WAV files go to /tmp/mb-scratch/sfx/, never into the repository.
set -euo pipefail
cd "$(dirname "$0")"
PY="${MB_PYTHON:-/opt/mbtools/venv/bin/python}"
export PYTHONDONTWRITEBYTECODE=1
exec "$PY" build.py "$@"
