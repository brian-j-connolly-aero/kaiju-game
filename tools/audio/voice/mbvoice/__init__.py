"""Voice line generator for Monster Battle 9001: offline speech synthesis, radio, broadcast and
hall processing, loudness mastering, encoding and speech-recognition checks."""

from pathlib import Path
import os

SR = 44100
VOICE_DIR = Path(__file__).resolve().parent.parent          # tools/audio/voice
REPO = VOICE_DIR.parents[2]
SCRIPT_JSON = REPO / "shared" / "src" / "defs" / "voiceLines.json"
# the lines the client says itself for events of phases 2 and 3 that have no simulation cue,
# and the module that lists their cues (client/src/audio/eventVoice.ts, EVENT_CUES)
EVENT_JSON = REPO / "client" / "src" / "audio" / "eventLines.json"
EVENT_TS = REPO / "client" / "src" / "audio" / "eventVoice.ts"
OUT_DIR = REPO / "client" / "public" / "assets" / "audio" / "voice"
MANIFEST = REPO / "client" / "public" / "assets" / "manifest.voice.json"
DOC = REPO / "docs" / "audio" / "VOICE.md"
DOC_DIR = REPO / "docs" / "audio" / "voice"
SCRATCH = Path(os.environ.get("MB_SCRATCH", "/tmp/mb-scratch/voice"))
