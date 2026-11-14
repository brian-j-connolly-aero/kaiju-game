#!/usr/bin/env bash
# Builds the voice lines: checks the script against its writing rules, then offline speech
# synthesis, radio / broadcast / hall processing, loudness mastering, .ogg and .mp3 encoding, the
# partial manifest, speech-recognition checks, measurements, pictures, docs/audio/VOICE.md and the
# readable copy of the script, docs/VOICE_SCRIPT.md.
#
#   tools/audio/voice/build.sh                  build the lines whose text, voice or chain changed,
#                                               then verify and regenerate the docs
#   tools/audio/voice/build.sh 'v_clock_*'      only the line ids that match (still only if changed)
#   tools/audio/voice/build.sh --force          rebuild every line
#   tools/audio/voice/build.sh --no-verify      skip measurements, pictures and docs
#   tools/audio/voice/build.sh --verify-only    measure and document the files already built
#   tools/audio/voice/build.sh --jobs 3         worker processes (default 2)
#
# To try a wording before it goes into the script: tools/audio/voice/tryline.py <Voice> "text" ..
#
# Inputs: shared/src/defs/voiceLines.json (the script, read-only), cast.json (who speaks with
# which synthesizer voice and chain), pronounce.json (respellings fed to the synthesizer; the
# subtitle text never changes). build_state.json remembers what each line was built from.
# Intermediate WAV files go to $MB_SCRATCH (default /tmp/mb-scratch/voice), never the repository.
# The neural voice models and the measuring models (about 1.1 GB) are downloaded from Hugging Face
# into $MB_MODELS (default /opt/mbtools/models) the first time they are needed, never the
# repository; after that the build needs no network. The speech model uses $MB_TTS_THREADS
# processor threads in all (default 2).
# Needs the asset tools (tools/setup-asset-tools.sh). See docs/audio/VOICE.md.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
py="${MB_PYTHON:-/opt/mbtools/venv/bin/python}"
[ -x "$py" ] || { echo "missing $py: run tools/setup-asset-tools.sh" >&2; exit 1; }
for tool in ffmpeg ffprobe; do
  command -v "$tool" >/dev/null || { echo "missing $tool: run tools/setup-asset-tools.sh" >&2; exit 1; }
done
"$py" -c "import onnxruntime, kokoro_onnx, misaki, spacy, en_core_web_sm, piper, sherpa_onnx" 2>/dev/null \
  || { echo "missing the neural voice packages: run tools/setup-asset-tools.sh" >&2; exit 1; }
export PYTHONDONTWRITEBYTECODE=1
exec "$py" "$here/build.py" "$@"
