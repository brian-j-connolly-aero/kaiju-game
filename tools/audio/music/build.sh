#!/usr/bin/env bash
# Builds the whole soundtrack from source: score (Python) -> MIDI -> fluidsynth (FluidR3_GM)
# -> mix, hall reverb, mastering -> .ogg and .mp3 in client/public/assets/audio/music/
# plus client/public/assets/manifest.music.json.
#
#   tools/audio/music/build.sh                 build everything, then measure and draw spectrograms
#   tools/audio/music/build.sh lobby stage2    build only these cues (stage1, stage2 and stage3 each
#                                              build their base and combat stems together)
#   tools/audio/music/build.sh --review        print the composer's score review only (no audio)
#   tools/audio/music/build.sh --no-verify     skip the measurements and spectrograms
#
# Needs the asset tools (tools/setup-asset-tools.sh): fluidsynth, the FluidR3_GM soundfont,
# ffmpeg, and /opt/mbtools/venv with mido, numpy, scipy, soundfile, pillow.
# Intermediate MIDI and WAV files go to $MB_SCRATCH (default /tmp/mb-scratch/music), never the repo.
# See docs/audio/MUSIC.md for what the music is and how the client should play it.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
py="${MB_PYTHON:-/opt/mbtools/venv/bin/python}"
for tool in fluidsynth ffmpeg; do
  command -v "$tool" >/dev/null || { echo "missing $tool: run tools/setup-asset-tools.sh" >&2; exit 1; }
done
[ -x "$py" ] || { echo "missing $py: run tools/setup-asset-tools.sh" >&2; exit 1; }

args=()
verify=1
review=0
for a in "$@"; do
  case "$a" in
    --no-verify) verify=0 ;;
    --review) review=1; args+=("$a") ;;
    *) args+=("$a") ;;
  esac
done
if [ "$review" = 0 ]; then
  # the score must pass its own review before any audio is rendered
  "$py" "$here/build.py" --review ${args[@]+"${args[@]}"} >/dev/null || {
    "$py" "$here/build.py" --review ${args[@]+"${args[@]}"}; echo "score review failed" >&2; exit 1; }
  [ "$verify" = 1 ] && args+=("--verify")
fi
exec "$py" "$here/build.py" ${args[@]+"${args[@]}"}
