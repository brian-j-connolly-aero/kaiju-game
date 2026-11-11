#!/usr/bin/env bash
# Installs the art and audio toolchain used by tools/art and tools/audio on Ubuntu 24.04.
# Safe to re-run. Needs root (apt) and the uv Python tool.
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq fluidsynth fluid-soundfont-gm sox libsox-fmt-all espeak-ng rhvoice \
  rhvoice-english flite festival festvox-us-slt-hts libttspico-utils vorbis-tools ffmpeg \
  libegl1 libgl1 libxrender1 libxi6 libxkbcommon0 libsm6 libxxf86vm1 libxfixes3
mkdir -p /opt/mbtools
[ -x /opt/mbtools/venv/bin/python ] || uv venv --python 3.13 /opt/mbtools/venv
uv pip install --python /opt/mbtools/venv/bin/python bpy==5.2.4 numpy scipy pillow mido \
  soundfile pedalboard pocketsphinx
echo "Asset tools ready: /opt/mbtools/venv/bin/python"
