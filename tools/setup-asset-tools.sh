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
# Neural voices (tools/audio/voice, docs/audio/VOICE.md section 8): Kokoro and Piper run on ONNX
# Runtime; misaki gives Kokoro its pronunciations (with spaCy's small English model, which comes
# from Hugging Face below); sherpa-onnx runs the second speech recognizer. No PyTorch. The voice
# build downloads the model files itself, into /opt/mbtools/models, the first time it needs them.
uv pip install --python /opt/mbtools/venv/bin/python kokoro-onnx==0.6.1 piper-tts==1.8.0 \
  misaki==0.9.4 spacy==3.8.18 num2words==0.5.14 sherpa-onnx==2.0.1
if ! /opt/mbtools/venv/bin/python -c "import en_core_web_sm" 2>/dev/null; then
  # spaCy's English model is on Hugging Face as a wheel with no version in its file name; it is
  # saved under its real name (version 3.7.1, which spaCy 3.8 loads) and installed without its pin.
  mkdir -p /opt/mbtools/downloads
  whl=/opt/mbtools/downloads/en_core_web_sm-3.7.1-py3-none-any.whl
  /opt/mbtools/venv/bin/python -c "import sys, urllib.request; urllib.request.urlretrieve(sys.argv[1], sys.argv[2])" \
    "https://huggingface.co/spacy/en_core_web_sm/resolve/8fb6f8155286360bf5486fe399e2738d1df7ded2/en_core_web_sm-any-py3-none-any.whl" \
    "$whl"
  echo "86cc141f63942d4b2c5fcee06630fd6f904788d2f0ab005cce45aadb8fb73889  $whl" | sha256sum -c -
  uv pip install --python /opt/mbtools/venv/bin/python --no-deps "$whl"
fi
echo "Asset tools ready: /opt/mbtools/venv/bin/python"
